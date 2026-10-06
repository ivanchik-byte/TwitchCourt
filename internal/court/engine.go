package court

import (
	"context"
	"encoding/base64"
	"fmt"
	"html"
	"log"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"stream-tribunal/internal/ai"
	"stream-tribunal/internal/audio"
	"stream-tribunal/internal/bot"
	"stream-tribunal/internal/config"
	"stream-tribunal/internal/memory"
	"stream-tribunal/internal/obs"
	"stream-tribunal/internal/safety"
)

type State string

const (
	StateIdle         State = "idle"
	StateIndictment   State = "indictment"
	StateTestimony    State = "testimony"
	StateDefense      State = "defense"
	StateObjection    State = "objection"
	StateDeliberation State = "deliberation"
	StateVerdict      State = "verdict"
)

type TrialCase struct {
	Defendant   string
	Crime       string
	ChatContext string
	Witnesses   []Witness
	Judge       ai.JudgeStyle
	Defense     string
	Viewer      string
	Testimony   []string
	Bribed      bool
}

// Witness represents a donation queued as trial testimony.
type Witness struct {
	Donor    string
	Amount   float64
	Currency string
	Message  string
}

const maxWitnessMessageRunes = 140
const maxWitnesses = 10

// maxDefenseRunes caps the streamer's live defense fed into the counter-prompt
const maxDefenseRunes = 600

type Engine struct {
	cfg         atomic.Pointer[config.Config]
	hub         *obs.Hub
	aiClient    *ai.Client
	voice       audio.Synthesizer
	filter      *safety.Filter
	recall      *memory.Store
	deck        *bot.Deck
	VerdictHook func(verdict, penalty string, guilty, innocent int, twist string)
	// TimeoutHook jails or bans a convicted viewer; wired to Twitch chat in main
	TimeoutHook       func(user string, secs int, ban bool, reason string)
	mu                sync.RWMutex
	speakMu           sync.Mutex
	state             State
	currCase          *TrialCase
	pool              []PoolSeat
	pendingPunishment Punishment
	cancelFn          context.CancelFunc
}

func NewEngine(cfg *config.Config, hub *obs.Hub, aiClient *ai.Client, voice audio.Synthesizer, filter *safety.Filter) *Engine {
	e := &Engine{
		hub:               hub,
		aiClient:          aiClient,
		voice:             voice,
		filter:            filter,
		recall:            memory.NewStore(""),
		state:             StateIdle,
		pendingPunishment: Punishment{Kind: "timeout", Secs: 90},
	}
	if cfg != nil {
		e.cfg.Store(cfg)
	} else {
		e.cfg.Store(config.DefaultConfig())
	}
	return e
}

// SwapConfig publishes a mutated clone for pipeline readers (RCU).
func (e *Engine) SwapConfig(next *config.Config) {
	if next != nil {
		e.cfg.Store(next)
	}
}

func (e *Engine) applyVoiceProfile(voice, rate string) {
	type profiler interface{ SetVoiceProfile(string, string) }
	if p, ok := e.currentVoice().(profiler); ok {
		p.SetVoiceProfile(voice, rate)
	}
}

// SetVoice hot-swaps the speech synthesizer from the settings desk
func (e *Engine) SetVoice(voice audio.Synthesizer) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if voice != nil {
		e.voice = voice
	}
}

func (e *Engine) currentVoice() audio.Synthesizer {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.voice
}

// speak serializes voice profile switch, synthesis itself runs without the lock
func (e *Engine) speak(ctx context.Context, s ai.SentenceChunk, index int, isLast bool, speaker, voice, rate string) error {
	e.speakMu.Lock()
	e.applyVoiceProfile(voice, rate)
	voiceSynth := e.currentVoice()
	e.speakMu.Unlock()
	return e.dispatchSpeechChunkWith(ctx, s, index, isLast, speaker, voiceSynth)
}

// castVoice maps an Edge voice name to the Silero speaker when the
// Silero engine is active, so one config drives every engine.
func (e *Engine) castVoice(edge, silero string) string {
	if e.cfg.Load().TTS.Engine == "silero" && silero != "" {
		return silero
	}
	return edge
}

func (e *Engine) AttachMemory(store *memory.Store) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if store != nil {
		e.recall = store
	}
}

func (e *Engine) SetPunishments(items []string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.deck = bot.NewDeck(items)
}

// SetAI hot-swaps the language model client from the settings desk
func (e *Engine) SetAI(client *ai.Client) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if client != nil {
		e.aiClient = client
	}
}

func (e *Engine) currentAI() *ai.Client {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.aiClient
}

// PingAI measures one real inference round-trip (ms to first token).
func (e *Engine) PingAI(ctx context.Context) (ms int64, mock bool, err error) {
	client := e.currentAI()
	if client == nil {
		return 0, true, fmt.Errorf("no ai client")
	}
	if client.IsMock() {
		return 0, true, nil
	}
	start := time.Now()
	done, cancel := context.WithCancel(ctx)
	defer cancel()
	gotFirst := false
	err = client.StreamCompletion(done,
		[]ai.ChatMessage{{Role: "user", Content: "Ответь одним словом: да."}},
		func(string) error {
			if !gotFirst {
				ms = time.Since(start).Milliseconds()
				gotFirst = true
				cancel()
			}
			return nil
		})
	if !gotFirst {
		return 0, false, err
	}
	return ms, false, nil
}

func (e *Engine) GetState() State {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.state
}

func (e *Engine) TriggerPanic() {
	e.mu.Lock()
	if e.cancelFn != nil {
		e.cancelFn()
		e.cancelFn = nil
	}
	e.state = StateIdle
	e.currCase = nil
	e.mu.Unlock()

	e.hub.BroadcastEvent(obs.EventPanic, map[string]string{"status": "muted"})
	e.hub.BroadcastEvent(obs.EventStateChange, obs.StateChangePayload{State: string(StateIdle)})
	log.Println("emergency panic triggered: trial aborted and overlay reset")
}

func (e *Engine) StartTrial(defendant, crime, chatContext string) error {
	return e.startTrialWith(defendant, crime, chatContext, "")
}

// StartViewerTrial opens an opt-in viewer trial; a guilty verdict
// puts the viewer into chat jail via TimeoutHook
func (e *Engine) StartViewerTrial(viewer, crime string) error {
	return e.startTrialWith(viewer, "Проступок зрителя: "+crime, "Сам вызвался на скамью", viewer)
}

// StartUnbanTrial opens a variant-B pardon trial: the AI defends the banned
// user from their appeal text, the streamer attacks over the mic, the judge
// verdicts. Executing the pardon stays manual via /api/unban/resolve.
// NOTE(discord): a third format (streamer + discord opponent as second voice)
// needs per-speaker audio capture and is parked until then.
func (e *Engine) StartUnbanTrial(user, appeal string) error {
	crime := "Апелляция на разбан: " + appeal
	chatContext := "UNBAN-ТРИБУНАЛ. Подсудимого нет в чате. " +
		"ИИ — адвокат: защищает " + user + " и требует разбана. " +
		"Стример в микрофон — обвинитель: его реплики это атака, а не защита. " +
		"Судья выслушивает обе стороны и выносит вердикт."
	return e.startTrialWith(user, crime, chatContext, "")
}

func (e *Engine) startTrialWith(defendant, crime, chatContext, viewer string) error {
	e.mu.Lock()
	if e.state != StateIdle {
		e.mu.Unlock()
		return fmt.Errorf("court is already in session (current state: %s)", e.state)
	}

	ctx, cancel := context.WithCancel(context.Background())
	e.cancelFn = cancel
	e.state = StateIndictment
	e.currCase = &TrialCase{
		Defendant:   e.filter.Sanitize(defendant),
		Crime:       e.filter.Sanitize(crime),
		ChatContext: e.filter.Sanitize(chatContext),
		Judge:       ai.JudgeFor(e.cfg.Load().Courtroom.JudgeStyle),
		Viewer:      e.filter.Sanitize(viewer),
	}
	currentCase := e.currCase
	e.mu.Unlock()

	e.hub.BroadcastEvent(obs.EventStateChange, obs.StateChangePayload{
		State:     string(StateIndictment),
		CaseTitle: "ДЕЛО №" + fmt.Sprintf("%d", time.Now().Unix()%1000),
		Defendant: currentCase.Defendant,
		Charge:    currentCase.Crime,
	})

	go e.runTrialPipeline(ctx, currentCase)
	return nil
}

func (e *Engine) runTrialPipeline(ctx context.Context, c *TrialCase) {
	smart := ""
	if e.recall != nil {
		smart = e.recall.SmartContext(c.Defendant)
	}
	prompt := ai.BuildIndictmentPromptWithMemory(c.Defendant, c.Crime, c.ChatContext, smart)
	messages := []ai.ChatMessage{
		{Role: "system", Content: c.Judge.System},
		{Role: "user", Content: prompt},
	}

	type queued struct {
		chunk ai.SentenceChunk
		index int
		last  bool
	}
	speechQueue := make(chan queued, 16)
	speechDone := make(chan struct{})

	go func() {
		defer close(speechDone)
		for item := range speechQueue {
			if err := e.speak(ctx, item.chunk, item.index, item.last,
				e.cfg.Load().Courtroom.JudgeName, e.castVoice(e.cfg.Load().TTS.JudgeVoice, e.cfg.Load().TTS.SileroJudge), e.cfg.Load().TTS.JudgeRate); err != nil {
				return
			}
		}
	}()

	chunker := ai.NewPhaseChunker("objection")
	chunkIndex := 0

	err := e.currentAI().StreamCompletion(ctx, messages, func(delta string) error {
		for _, s := range chunker.Feed(delta) {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case speechQueue <- queued{chunk: s, index: chunkIndex}:
				chunkIndex++
			}
		}
		return nil
	})

	// the show goes on even when the model chokes: a standby line keeps the timing
	if err != nil {
		log.Printf("indictment stream failed, using standby: %v", err)
		for _, s := range chunker.Feed("Суд отклоняет возню и продолжает заседание! ") {
			select {
			case <-ctx.Done():
			case speechQueue <- queued{chunk: s, index: chunkIndex}:
				chunkIndex++
			}
		}
	}
	if last := chunker.Flush(); last != nil {
		select {
		case <-ctx.Done():
		case speechQueue <- queued{chunk: *last, index: chunkIndex, last: true}:
		}
	}
	close(speechQueue)

	select {
	case <-ctx.Done():
		return
	case <-speechDone:
	}

	e.runTestimonyWindow(ctx, c)
	if ctx.Err() != nil {
		return
	}
	defense := e.runDefenseWindow(ctx, c)
	if ctx.Err() != nil {
		return
	}
	e.runObjection(ctx, c, chunkIndex+1, defense)
	if ctx.Err() != nil {
		return
	}

	// read queued testimony before the bench retires
	if interlude := e.drainWitnessInterlude(c); interlude != "" {
		if err := e.speak(ctx, ai.SentenceChunk{Text: interlude, Animation: "slam"}, chunkIndex, false,
			e.cfg.Load().Courtroom.JudgeName, e.castVoice(e.cfg.Load().TTS.JudgeVoice, e.cfg.Load().TTS.SileroJudge), e.cfg.Load().TTS.JudgeRate); err != nil {
			log.Printf("witness interlude speech failed: %v", err)
		}
	}

	guilty, decided := e.deliberate(ctx, c, chunkIndex+1)
	if ctx.Err() != nil {
		return
	}

	e.finalizeVerdict(ctx, c, guilty, decided)
	e.clearTrial()
}

func (e *Engine) clearTrial() {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.state == StateIdle && e.cancelFn != nil {
		e.cancelFn()
		e.cancelFn = nil
	}
}

// deliberate retires the bench: the judge speaks the ruling aloud,
// and its first word decides the verdict
func (e *Engine) deliberate(ctx context.Context, c *TrialCase, startIndex int) (guilty, decided bool) {
	e.mu.Lock()
	if e.currCase != c {
		e.mu.Unlock()
		return false, false
	}
	e.state = StateDeliberation
	e.mu.Unlock()

	e.hub.BroadcastEvent(obs.EventStateChange, obs.StateChangePayload{State: string(StateDeliberation)})

	testimony := e.caseTestimony(c)
	messages := []ai.ChatMessage{
		{Role: "system", Content: c.Judge.System},
		{Role: "user", Content: ai.BuildDeliberationPrompt(c.Defendant, c.Crime, testimony)},
	}
	var ruling strings.Builder
	chunker := ai.NewPhaseChunker("slam", "objection", "desk_slam", "shock", "nod")
	index := startIndex
	streamErr := e.currentAI().StreamCompletion(ctx, messages, func(delta string) error {
		ruling.WriteString(delta)
		for _, s := range chunker.Feed(delta) {
			if err := e.speak(ctx, s, index, false,
				e.cfg.Load().Courtroom.JudgeName, e.castVoice(e.cfg.Load().TTS.JudgeVoice, e.cfg.Load().TTS.SileroJudge), e.cfg.Load().TTS.JudgeRate); err != nil {
				return err
			}
			index++
		}
		return nil
	})
	if streamErr != nil {
		log.Printf("deliberation stream failed, verdict undecided: %v", streamErr)
		if ctx.Err() == nil {
			standby := "Судья запнулся. Решение откладывается."
			for _, s := range chunker.Feed(standby + " ") {
				if err := e.speak(ctx, s, index, false,
					e.cfg.Load().Courtroom.JudgeName, e.castVoice(e.cfg.Load().TTS.JudgeVoice, e.cfg.Load().TTS.SileroJudge), e.cfg.Load().TTS.JudgeRate); err != nil {
					log.Printf("standby speech failed: %v", err)
				}
				index++
			}
		}
	}
	if last := chunker.Flush(); last != nil {
		if err := e.speak(ctx, *last, index, false,
			e.cfg.Load().Courtroom.JudgeName, e.castVoice(e.cfg.Load().TTS.JudgeVoice, e.cfg.Load().TTS.SileroJudge), e.cfg.Load().TTS.JudgeRate); err != nil {
			log.Printf("deliberation flush speech failed: %v", err)
		}
	}
	return ai.ParseVerdict(ruling.String())
}

// caseTestimony bundles everything the bench must weigh.
// Snapshots case slices under lock so concurrent chat writes can't race the read.
func (e *Engine) caseTestimony(c *TrialCase) string {
	e.mu.RLock()
	testimony := append([]string(nil), c.Testimony...)
	defense := c.Defense
	witnesses := append([]Witness(nil), c.Witnesses...)
	e.mu.RUnlock()
	parts := []string{}
	for _, t := range testimony {
		if t = strings.TrimSpace(t); t != "" {
			parts = append(parts, "Подсудимый: "+t)
		}
	}
	if e.recall != nil {
		var snitches []string
		for _, l := range e.recall.RecentComments(10) {
			text := strings.TrimSpace(html.UnescapeString(l.Text))
			if !strings.HasPrefix(strings.ToLower(text), "!snitch") {
				continue
			}
			text = strings.TrimSpace(text[len("!snitch"):])
			if text == "" {
				continue
			}
			author := l.Author
			if author == "" {
				author = "зал"
			}
			snitches = append(snitches, author+": "+truncateRunes(text, maxTestimonyRunes))
		}
		if len(snitches) > 3 {
			snitches = snitches[len(snitches)-3:]
		}
		if len(snitches) > 0 {
			parts = append(parts, "Доносы зала: "+strings.Join(snitches, " / "))
		}
	}
	if d := strings.TrimSpace(html.UnescapeString(defense)); d != "" {
		parts = append(parts, "Защита: "+d)
	}
	if w := buildWitnessInterlude(witnesses); w != "" {
		parts = append(parts, w)
	}
	if len(parts) == 0 {
		return "Подсудимый молчал, зал шумел."
	}
	return strings.Join(parts, "\n")
}

// runTestimonyWindow gives the defendant the floor in chat
func (e *Engine) runTestimonyWindow(ctx context.Context, c *TrialCase) {
	dur := e.cfg.Load().Courtroom.TestimonySec
	if dur <= 0 {
		dur = 25
	}
	e.mu.Lock()
	if e.state != StateIndictment || e.currCase != c {
		e.mu.Unlock()
		return
	}
	e.state = StateTestimony
	e.mu.Unlock()

	e.hub.BroadcastEvent(obs.EventStateChange, obs.StateChangePayload{
		State:       string(StateTestimony),
		Defendant:   c.Defendant,
		TimeLeftSec: dur,
	})

	select {
	case <-ctx.Done():
	case <-time.After(time.Duration(dur) * time.Second):
	}
}

// runDefenseWindow opens the floor to the streamer and returns what was said
func (e *Engine) runDefenseWindow(ctx context.Context, c *TrialCase) string {
	dur := e.cfg.Load().Courtroom.DefenseSec
	if dur <= 0 {
		dur = 20
	}
	e.mu.Lock()
	if e.currCase != c || (e.state != StateIndictment && e.state != StateTestimony) {
		e.mu.Unlock()
		return ""
	}
	e.state = StateDefense
	e.mu.Unlock()

	e.hub.BroadcastEvent(obs.EventStateChange, obs.StateChangePayload{
		State:       string(StateDefense),
		TimeLeftSec: dur,
	})

	select {
	case <-ctx.Done():
		return ""
	case <-time.After(time.Duration(dur) * time.Second):
	}

	e.mu.Lock()
	defer e.mu.Unlock()
	return c.Defense
}

// runObjection lets the prosecutor interrupt the streamer with a counter-punch
func (e *Engine) runObjection(ctx context.Context, c *TrialCase, startIndex int, defense string) {
	e.mu.Lock()
	if e.currCase != c {
		e.mu.Unlock()
		return
	}
	e.state = StateObjection
	e.mu.Unlock()

	e.hub.BroadcastEvent(obs.EventStateChange, obs.StateChangePayload{State: string(StateObjection)})

	if strings.TrimSpace(html.UnescapeString(defense)) == "" {
		defense = e.fallbackDefense()
	}
	messages := []ai.ChatMessage{
		{Role: "system", Content: c.Judge.System},
		{Role: "user", Content: ai.BuildCounterArgumentPrompt(defense)},
	}
	chunker := ai.NewSentenceChunker()
	index := startIndex
	if err := e.currentAI().StreamCompletion(ctx, messages, func(delta string) error {
		for _, s := range chunker.Feed(delta) {
			if err := e.speak(ctx, s, index, false,
				e.cfg.Load().Courtroom.JudgeName, e.castVoice(e.cfg.Load().TTS.JudgeVoice, e.cfg.Load().TTS.SileroJudge), e.cfg.Load().TTS.JudgeRate); err != nil {
				return err
			}
			index++
		}
		return nil
	}); err != nil {
		log.Printf("objection stream failed, using standby: %v", err)
		if ctx.Err() == nil {
			if serr := e.speak(ctx, ai.SentenceChunk{Text: "Суд не расслышал оправданий и продолжает!", Animation: "objection"}, index, false,
				e.cfg.Load().Courtroom.JudgeName, e.castVoice(e.cfg.Load().TTS.JudgeVoice, e.cfg.Load().TTS.SileroJudge), e.cfg.Load().TTS.JudgeRate); serr != nil {
				log.Printf("objection standby speech failed: %v", serr)
			}
		}
	}
	if last := chunker.Flush(); last != nil {
		if err := e.speak(ctx, *last, index, false,
			e.cfg.Load().Courtroom.JudgeName, e.castVoice(e.cfg.Load().TTS.JudgeVoice, e.cfg.Load().TTS.SileroJudge), e.cfg.Load().TTS.JudgeRate); err != nil {
			log.Printf("objection flush speech failed: %v", err)
		}
	}
}

// fallbackDefense feeds recent chat lines when the streamer stayed silent
func (e *Engine) fallbackDefense() string {
	if e.recall == nil {
		return "молчит как партизан"
	}
	lines := e.recall.RecentComments(3)
	parts := make([]string, 0, len(lines))
	for _, l := range lines {
		author := l.Author
		if author == "" {
			author = "чат"
		}
		parts = append(parts, author+": "+html.UnescapeString(l.Text))
	}
	if len(parts) == 0 {
		return "молчит как партизан"
	}
	return strings.Join(parts, " / ")
}

// AddDefense appends a line of the streamer's live defense; open only in the defense window
func (e *Engine) AddDefense(author, text string) bool {
	cleanAuthor := e.filter.Sanitize(author)
	if cleanAuthor == "" {
		cleanAuthor = "стример"
	}
	clean := e.filter.Sanitize(text)
	if strings.TrimSpace(html.UnescapeString(clean)) == "" {
		return false
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.state != StateDefense || e.currCase == nil {
		return false
	}
	line := cleanAuthor + ": " + html.UnescapeString(clean)
	if e.currCase.Defense != "" {
		e.currCase.Defense += " / "
	}
	e.currCase.Defense = truncateRunesTail(e.currCase.Defense+line, maxDefenseRunes)
	return true
}

var ssmlDisplayRe = regexp.MustCompile(`<break[^>]*/?>`)

func (e *Engine) dispatchSpeechChunk(ctx context.Context, s ai.SentenceChunk, index int, isLast bool, speaker string) error {
	return e.dispatchSpeechChunkWith(ctx, s, index, isLast, speaker, e.currentVoice())
}

func (e *Engine) dispatchSpeechChunkWith(ctx context.Context, s ai.SentenceChunk, index int, isLast bool, speaker string, voice audio.Synthesizer) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	if speaker == "" {
		speaker = e.cfg.Load().Courtroom.JudgeName
	}

	if s.Animation != "" {
		e.hub.BroadcastEvent(obs.EventAnimation, obs.AnimationPayload{Name: s.Animation})
	}

	// user input arrives escaped: unwrap entities before voice and display
	// (break tags stay intact for Edge SSML, XSS is dead via textContent)
	speechText := html.UnescapeString(s.Text)

	// strip SSML pause tags from subtitle display
	shown := strings.TrimSpace(ssmlDisplayRe.ReplaceAllString(speechText, ""))
	e.hub.BroadcastEvent(obs.EventSubtitles, obs.SubtitlesPayload{
		Speaker: speaker,
		Text:    shown,
	})

	if e.recall != nil {
		e.recall.AddSpeechLine(shown)
	}

	synthCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	rawBytes, err := voice.Synthesize(synthCtx, speechText)
	if err != nil {
		log.Printf("tts synthesis error: %v", err)
		return err
	}
	if len(rawBytes) == 0 {
		return fmt.Errorf("tts returned no audio")
	}

	b64Audio := base64.StdEncoding.EncodeToString(rawBytes)
	e.hub.BroadcastEvent(obs.EventAudioChunk, obs.AudioChunkPayload{
		Index:       index,
		AudioBase64: b64Audio,
		Text:        shown,
		IsLast:      isLast,
	})

	return nil
}

// Say speaks immediately using the judge voice (gavel interjections)
func (e *Engine) Say(text string) {
	clean := e.filter.Sanitize(text)
	if clean == "" {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()
		if err := e.speak(ctx, ai.SentenceChunk{Text: clean, Animation: "slam"}, 0, true,
			e.cfg.Load().Courtroom.JudgeName, e.castVoice(e.cfg.Load().TTS.JudgeVoice, e.cfg.Load().TTS.SileroJudge), e.cfg.Load().TTS.JudgeRate); err != nil {
			log.Printf("gavel interjection speech failed: %v", err)
		}
	}()
}

func (e *Engine) AddChatComment(author, text string) {
	if e.recall == nil {
		return
	}
	cleanAuthor := e.filter.Sanitize(author)
	cleanText := e.filter.Sanitize(text)
	e.recall.AddComment(cleanAuthor, cleanText)
}

// AddWitness queues testimony; returns false when no trial is active
func (e *Engine) AddWitness(donor string, amount float64, currency, message string) bool {
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.state == StateIdle || e.currCase == nil {
		return false
	}

	cleanDonor := e.filter.Sanitize(donor)
	if cleanDonor == "" {
		cleanDonor = "Аноним"
	}
	w := Witness{
		Donor:    cleanDonor,
		Amount:   amount,
		Currency: strings.TrimSpace(currency),
		Message:  e.filter.Sanitize(message),
	}
	e.currCase.Witnesses = append(e.currCase.Witnesses, w)
	if len(e.currCase.Witnesses) > maxWitnesses {
		e.currCase.Witnesses = e.currCase.Witnesses[len(e.currCase.Witnesses)-maxWitnesses:]
	}

	if e.recall != nil {
		e.recall.AddComment(cleanDonor, "свидетель: "+w.Message)
	}
	return true
}

func buildWitnessInterlude(witnesses []Witness) string {
	if len(witnesses) == 0 {
		return ""
	}

	var sb strings.Builder
	sb.WriteString("Суд приобщает показания свидетелей. ")
	for _, w := range witnesses {
		amount := strconv.FormatFloat(w.Amount, 'f', -1, 64)
		sb.WriteString("Свидетель " + w.Donor + " вносит " + amount)
		if w.Currency != "" {
			sb.WriteString(" " + w.Currency)
		}
		if strings.TrimSpace(html.UnescapeString(w.Message)) != "" {
			sb.WriteString(" и заявляет: " + truncateRunes(html.UnescapeString(w.Message), maxWitnessMessageRunes))
		}
		sb.WriteString(". ")
	}
	sb.WriteString("Показания приобщены к делу!")
	return sb.String()
}

func truncateRunes(s string, max int) string {
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max]) + "..."
}

// truncateRunesTail keeps the freshest tail so a new defense line
// is never dropped in favor of stale text.
func truncateRunesTail(s string, max int) string {
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return "..." + string(runes[len(runes)-max:])
}

func (e *Engine) drainWitnessInterlude(c *TrialCase) string {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return buildWitnessInterlude(c.Witnesses)
}

// AddBribe flags donor money; first bribe per trial wins
func (e *Engine) AddBribe(donor string, amount float64, currency string) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.state == StateIdle || e.currCase == nil || e.currCase.Bribed {
		return false
	}
	e.currCase.Bribed = true
	return true
}

// verdictSentence packs the penalty and the twist into one gavel line
func verdictSentence(verdict, penalty, twist string) string {
	parts := []string{}
	if penalty != "" {
		parts = append(parts, "Наказание суда: "+penalty+".")
	}
	if twist != "" {
		parts = append(parts, twist)
	}
	return strings.Join(parts, " ")
}

func (e *Engine) finalizeVerdict(ctx context.Context, c *TrialCase, guilty, decided bool) {
	e.mu.Lock()
	e.state = StateVerdict
	isGuilty := guilty
	twist := ""
	if c.Bribed {
		twist = "Судья переобулся прямо в зале: взятка принята, весы качнулись к оправданию!"
	}
	if !decided {
		isGuilty = false
		if twist != "" {
			twist += " "
		}
		twist += "Судья не решился и отпустил подсудимого."
	}
	verdictStr := "НЕВИНОВЕН"
	guiltyVotes := 0
	innocentVotes := 1
	if isGuilty {
		verdictStr = "ВИНОВЕН"
		guiltyVotes = 1
		innocentVotes = 0
	}
	totalVotes := 1
	witnessCount := len(c.Witnesses)
	defendant := c.Defendant
	crime := c.Crime
	viewer := html.UnescapeString(c.Viewer)
	penalty := ""
	punish := e.pendingPunishment
	if isGuilty && viewer != "" {
		switch punish.Kind {
		case "pardon":
			penalty = "помилован лично стримером"
		case "ban":
			penalty = "изгнан из чата навсегда"
		default:
			penalty = "одиночная камера: мут на " + strconv.Itoa(punish.Secs) + " секунд"
		}
	} else if isGuilty && e.deck != nil {
		penalty = e.deck.Draw()
	}
	e.mu.Unlock()

	if e.recall != nil {
		summary := ""
		if lines := e.recall.RecentComments(3); len(lines) > 0 {
			last := lines[len(lines)-1].Text
			if len([]rune(last)) > 140 {
				last = string([]rune(last)[:140]) + "..."
			}
			summary = last
		}
		e.recall.AddTrial(memory.TrialRecord{
			Defendant: defendant,
			Crime:     crime,
			Verdict:   verdictStr,
			Guilty:    guiltyVotes,
			Innocent:  innocentVotes,
			Witnesses: witnessCount,
			Summary:   summary,
		})
		if e.recall.OffenderCount(defendant) == 3 {
			e.recall.NoteForAI(defendant + " в третий раз на скамье, зал помнит все прошлые выходки")
		}
		e.recall.ClearTranscript()
	}

	// the ruling itself was spoken during deliberation: only the penalty lands now
	if sentence := verdictSentence(verdictStr, penalty, twist); sentence != "" {
		if err := e.speak(ctx, ai.SentenceChunk{Text: sentence, Animation: "slam"}, 0, true,
			e.cfg.Load().Courtroom.JudgeName, e.castVoice(e.cfg.Load().TTS.JudgeVoice, e.cfg.Load().TTS.SileroJudge), e.cfg.Load().TTS.JudgeRate); err != nil {
			log.Printf("verdict sentence speech failed: %v", err)
		}
	}

	e.hub.BroadcastEvent(obs.EventVerdict, obs.VerdictPayload{
		Verdict:     verdictStr,
		GuiltyVotes: guiltyVotes,
		TotalVotes:  totalVotes,
		Witnesses:   witnessCount,
		Penalty:     penalty,
		Twist:       twist,
	})

	if e.VerdictHook != nil {
		e.VerdictHook(verdictStr, penalty, guiltyVotes, innocentVotes, twist)
	}
	if isGuilty && viewer != "" && e.TimeoutHook != nil {
		switch punish.Kind {
		case "pardon":
		case "ban":
			e.TimeoutHook(viewer, 0, true, "Решение суда: "+penalty)
		default:
			e.TimeoutHook(viewer, punish.Secs, false, "Решение суда: "+penalty)
		}
	}

	select {
	case <-ctx.Done():
		return
	case <-time.After(6 * time.Second):
	}

	e.mu.Lock()
	e.state = StateIdle
	e.currCase = nil
	e.mu.Unlock()

	e.hub.BroadcastEvent(obs.EventStateChange, obs.StateChangePayload{State: string(StateIdle)})
}
