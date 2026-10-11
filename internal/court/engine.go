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
	"stream-tribunal/internal/tmpl"
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
	Bribe       *BribeOffer
	// StreamerTrial marks a trial where the streamer is the defendant
	// and a dedicated AI prosecutor leads the charge.
	StreamerTrial bool
}

// BribeOffer is donor money on the table: the bench decides what to do
// with it (take, refuse, or punish the cheapskate), never a keyword flip.
type BribeOffer struct {
	Donor    string
	Amount   float64
	Currency string
	Message  string
}

// Witness represents a donation queued as trial testimony.
type Witness struct {
	Donor    string
	Amount   float64
	Currency string
	Message  string
	Flagged  bool
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
	recall      atomic.Pointer[memory.Store]
	deck        *bot.Deck
	VerdictHook func(verdict, penalty string, guilty, innocent int, twist string)
	// TimeoutHook jails or bans a convicted viewer; wired to Twitch chat in main
	TimeoutHook       func(user string, secs int, ban bool, reason string)
	mu                sync.RWMutex
	speakMu           sync.Mutex
	sayMu             sync.Mutex
	genMu             sync.Mutex
	genJob            GenJob
	state             State
	currCase          *TrialCase
	pool              []PoolSeat
	pendingPunishment Punishment
	cancelFn          context.CancelFunc
	trialCancel       context.CancelFunc
	trialGen          uint64
	cases             *CaseDeck
}

func NewEngine(cfg *config.Config, hub *obs.Hub, aiClient *ai.Client, voice audio.Synthesizer, filter *safety.Filter) *Engine {
	e := &Engine{
		hub:               hub,
		aiClient:          aiClient,
		voice:             voice,
		filter:            filter,
		state:             StateIdle,
		pendingPunishment: Punishment{Kind: "timeout", Secs: 90},
	}
	e.recall.Store(memory.NewStore(""))
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

// castVoice maps Edge voice name to Silero speaker when Silero engine is active
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
		e.recall.Store(store)
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
	if client == nil || !client.Configured() {
		return 0, false, fmt.Errorf("ai is not configured: set api_key or base_url in settings")
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
	if e.trialCancel != nil {
		e.trialCancel()
		e.trialCancel = nil
	}
	e.trialGen++
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

// StartViewerTrial opens an opt-in viewer trial
func (e *Engine) StartViewerTrial(viewer, crime string) error {
	return e.startTrialWith(viewer, "Проступок зрителя: "+crime, "Сам вызвался на скамью", viewer)
}

// StartCaseTrial opens a trial from a deck card: full details go to the bench.
// viewer=true keeps the opt-in punishment path for viewer defendants;
// viewer=false means the streamer is on the bench with a prosecutor on his tail.
func (e *Engine) StartCaseTrial(defendant string, card CaseCard, viewer bool) error {
	context := strings.TrimSpace(card.Context)
	if d := strings.TrimSpace(card.Details); d != "" {
		if context != "" {
			context += "\n"
		}
		context += "МАТЕРИАЛЫ ДЕЛА:\n" + d
	}
	if viewer {
		return e.startTrialWith(defendant, card.Crime, context, defendant)
	}
	return e.startTrialWithMode(defendant, card.Crime, context, "", true)
}

// StartUnbanTrial opens an unban pardon trial against the streamer
func (e *Engine) StartUnbanTrial(user, appeal string) error {
	crime := "Апелляция на разбан: " + appeal
	chatContext := "UNBAN-ТРИБУНАЛ. Подсудимого нет в чате. " +
		"ИИ адвокат: защищает " + user + " и требует разбана. " +
		"Стример в микрофон: выступает обвинителем, его реплики это атака, а не защита. " +
		"Судья выслушивает обе стороны и выносит вердикт."
	return e.startTrialWith(user, crime, chatContext, "")
}

// StartStreamerTrial opens a trial where the streamer is the defendant
// and a dedicated AI prosecutor leads the charge.
func (e *Engine) StartStreamerTrial(defendant, crime, chatContext string) error {
	return e.startTrialWithMode(defendant, crime, chatContext, "", true)
}

func (e *Engine) startTrialWith(defendant, crime, chatContext, viewer string) error {
	return e.startTrialWithMode(defendant, crime, chatContext, viewer, false)
}

func (e *Engine) startTrialWithMode(defendant, crime, chatContext, viewer string, streamerTrial bool) error {
	e.mu.Lock()
	if e.state != StateIdle {
		e.mu.Unlock()
		return fmt.Errorf("court is already in session (current state: %s)", e.state)
	}
	if e.aiClient == nil || !e.aiClient.Configured() {
		e.mu.Unlock()
		return fmt.Errorf("ai is not configured: set api_key or base_url in settings")
	}

	ctx, cancel := context.WithCancel(context.Background())
	// whole-trial deadline: phases, TTS and verdict must fit, never hang.
	// Parent cancel still wins (panic/abort), timeout just bounds the tail.
	trialCtx, trialCancel := context.WithTimeout(ctx, 6*time.Minute)
	e.cancelFn = cancel
	e.trialCancel = trialCancel
	e.trialGen++
	gen := e.trialGen
	e.state = StateIndictment
	e.currCase = &TrialCase{
		Defendant:     e.filter.Sanitize(truncateRunes(defendant, 80)),
		Crime:         e.filter.Sanitize(truncateRunes(crime, 300)),
		ChatContext:   e.filter.Sanitize(truncateRunes(chatContext, 1000)),
		Judge:         ai.JudgeFor(e.cfg.Load().Courtroom.JudgeStyle, e.cfg.Load().Prompts),
		Viewer:        e.filter.Sanitize(viewer),
		StreamerTrial: streamerTrial,
	}
	currentCase := e.currCase
	e.mu.Unlock()

	e.hub.BroadcastEvent(obs.EventStateChange, obs.StateChangePayload{
		State:     string(StateIndictment),
		CaseTitle: "ДЕЛО №" + fmt.Sprintf("%d", time.Now().Unix()%1000),
		Defendant: currentCase.Defendant,
		Charge:    currentCase.Crime,
	})

	go e.runTrialPipeline(trialCtx, currentCase, gen)
	return nil
}

// accuserSystem picks the voice that leads the charge: the prosecutor
// in streamer trials, the judge everywhere else. Deliberation always
// stays with the judge as arbiter.
func (e *Engine) accuserSystem(c *TrialCase) string {
	if c.StreamerTrial {
		return ai.ProsecutorFor(e.cfg.Load().Prompts).System
	}
	return c.Judge.System
}

func (e *Engine) runTrialPipeline(ctx context.Context, c *TrialCase, gen uint64) {
	defer e.finishTrial(gen)

	smart := ""
	if e.recall.Load() != nil {
		smart = e.recall.Load().SmartContext(c.Defendant)
	}
	prompt := ai.BuildIndictmentPromptWithMemory(c.Defendant, c.Crime, c.ChatContext, smart, e.cfg.Load().Prompts.TaskIndictment)
	messages := []ai.ChatMessage{
		{Role: "system", Content: e.accuserSystem(c)},
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

	// model choked: speak the configured standby line, if any, and move on
	if err != nil {
		log.Printf("indictment stream failed: %v", err)
		if standby := e.cfg.Load().Courtroom.StandbyIndictment; standby != "" {
			for _, s := range chunker.Feed(standby + " ") {
				select {
				case <-ctx.Done():
				case speechQueue <- queued{chunk: s, index: chunkIndex}:
					chunkIndex++
				}
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
		e.restIdle(gen)
		return
	case <-speechDone:
	}

	e.runTestimonyWindow(ctx, c)
	if ctx.Err() != nil {
		e.restIdle(gen)
		return
	}
	defense := e.runDefenseWindow(ctx, c)
	if ctx.Err() != nil {
		e.restIdle(gen)
		return
	}
	e.runObjection(ctx, c, chunkIndex+1, defense)
	if ctx.Err() != nil {
		e.restIdle(gen)
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
		e.restIdle(gen)
		return
	}

	e.finalizeVerdict(ctx, c, guilty, decided)
}

// restIdle parks a cancelled pipeline: never leave the bench stuck mid-phase.
func (e *Engine) restIdle(gen uint64) {
	e.mu.Lock()
	if e.trialGen != gen || e.state == StateIdle {
		e.mu.Unlock()
		return
	}
	e.state = StateIdle
	e.currCase = nil
	e.mu.Unlock()
	e.hub.BroadcastEvent(obs.EventStateChange, obs.StateChangePayload{State: string(StateIdle)})
}

// finishTrial releases the trial context, but only for its own generation:
// a stale pipeline must never kill a newer trial.
func (e *Engine) finishTrial(gen uint64) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.trialGen != gen {
		return
	}
	if e.cancelFn != nil {
		e.cancelFn()
		e.cancelFn = nil
	}
	if e.trialCancel != nil {
		e.trialCancel()
		e.trialCancel = nil
	}
}

// deliberate evaluates verdict and announces the ruling
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
	e.mu.RLock()
	var bribe *BribeOffer
	if c.Bribe != nil {
		cp := *c.Bribe
		bribe = &cp
	}
	e.mu.RUnlock()
	if bribe != nil {
		whisper := ""
		if strings.TrimSpace(html.UnescapeString(bribe.Message)) != "" {
			whisper = " и шепчет: «" + truncateRunes(html.UnescapeString(bribe.Message), maxTestimonyRunes) + "»"
		}
		note := tmpl.Fill(e.cfg.Load().Prompts.BribeNote, map[string]string{
			"donor":    html.UnescapeString(bribe.Donor),
			"amount":   strconv.FormatFloat(bribe.Amount, 'f', -1, 64),
			"currency": bribe.Currency,
			"message":  whisper,
		})
		if strings.TrimSpace(note) != "" {
			testimony += "\n" + note
		}
	}
	messages := []ai.ChatMessage{
		{Role: "system", Content: c.Judge.System},
		{Role: "user", Content: ai.BuildDeliberationPromptWithTask(c.Defendant, c.Crime, testimony, e.cfg.Load().Prompts.TaskDeliberation)},
	}
	var ruling strings.Builder
	// verdict keeps slam/shock/nod alive; only objection stays banned here
	chunker := ai.NewPhaseChunker("objection")
	index := startIndex

	// slow TTS must not block the SSE reader, or the 15s budget burns and the verdict parses undecided
	type queued struct {
		chunk ai.SentenceChunk
		index int
	}
	speechQueue := make(chan queued, 16)
	speechDone := make(chan struct{})
	judgeName := e.cfg.Load().Courtroom.JudgeName
	judgeVoice := e.castVoice(e.cfg.Load().TTS.JudgeVoice, e.cfg.Load().TTS.SileroJudge)
	judgeRate := e.cfg.Load().TTS.JudgeRate
	go func() {
		defer close(speechDone)
		for item := range speechQueue {
			if err := e.speak(ctx, item.chunk, item.index, false, judgeName, judgeVoice, judgeRate); err != nil {
				log.Printf("deliberation speech failed: %v", err)
				return
			}
		}
	}()

	streamErr := e.currentAI().StreamCompletion(ctx, messages, func(delta string) error {
		ruling.WriteString(delta)
		for _, s := range chunker.Feed(delta) {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case speechQueue <- queued{chunk: s, index: index}:
				index++
			}
		}
		return nil
	})
	if streamErr != nil {
		log.Printf("deliberation stream failed, verdict undecided: %v", streamErr)
		if ctx.Err() == nil {
			if standby := e.cfg.Load().Courtroom.StandbyDeliberation; standby != "" {
				for _, s := range chunker.Feed(standby + " ") {
					select {
					case <-ctx.Done():
					case speechQueue <- queued{chunk: s, index: index}:
						index++
					}
				}
			}
		}
	}
	if last := chunker.Flush(); last != nil {
		select {
		case <-ctx.Done():
		case speechQueue <- queued{chunk: *last, index: index}:
			index++
		}
	}
	close(speechQueue)

	select {
	case <-ctx.Done():
	case <-speechDone:
	}
	return ai.ParseVerdict(ruling.String())
}

// caseTestimony snapshots collected testimony slices under lock
func (e *Engine) caseTestimony(c *TrialCase) string {
	e.mu.RLock()
	testimony := append([]string(nil), c.Testimony...)
	defense := c.Defense
	witnesses := append([]Witness(nil), c.Witnesses...)
	e.mu.RUnlock()
	cfg := e.cfg.Load()
	parts := []string{}
	for _, t := range testimony {
		if t = strings.TrimSpace(t); t != "" {
			if p := cfg.Courtroom.TestimonyPrefix; p != "" {
				t = p + t
			}
			parts = append(parts, t)
		}
	}
	if e.recall.Load() != nil {
		var snitches []string
		for _, l := range e.recall.Load().RecentComments(10) {
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
			joined := strings.Join(snitches, " / ")
			if p := cfg.Courtroom.SnitchPrefix; p != "" {
				joined = p + joined
			}
			parts = append(parts, joined)
		}
	}
	if d := strings.TrimSpace(html.UnescapeString(defense)); d != "" {
		if p := cfg.Courtroom.DefensePrefix; p != "" {
			d = p + d
		}
		parts = append(parts, d)
	}
	if w := e.buildWitnessInterlude(witnesses); w != "" {
		parts = append(parts, w)
	}
	for _, w := range witnesses {
		if w.Flagged {
			// banned topic arrived via donation: not dropped, the bench condemns it
			if note := cfg.Prompts.CondemnNote; note != "" {
				parts = append(parts, note)
			}
			break
		}
	}
	if len(parts) == 0 {
		return e.cfg.Load().Courtroom.EmptyTestimony
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
		{Role: "system", Content: e.accuserSystem(c)},
		{Role: "user", Content: ai.BuildCounterArgumentPromptWithTask(defense, e.cfg.Load().Prompts.TaskCounter)},
	}
	chunker := ai.NewSentenceChunker()
	index := startIndex
	// same deal as deliberation: queue speech, don't block the reader
	type queuedObjection struct {
		chunk ai.SentenceChunk
		index int
	}
	objQueue := make(chan queuedObjection, 16)
	objDone := make(chan struct{})
	objJudge := e.cfg.Load().Courtroom.JudgeName
	objVoice := e.castVoice(e.cfg.Load().TTS.JudgeVoice, e.cfg.Load().TTS.SileroJudge)
	objRate := e.cfg.Load().TTS.JudgeRate
	go func() {
		defer close(objDone)
		for item := range objQueue {
			if err := e.speak(ctx, item.chunk, item.index, false, objJudge, objVoice, objRate); err != nil {
				log.Printf("objection speech failed: %v", err)
				return
			}
		}
	}()
	pushObj := func(s ai.SentenceChunk) {
		select {
		case <-ctx.Done():
		case objQueue <- queuedObjection{chunk: s, index: index}:
			index++
		}
	}
	if err := e.currentAI().StreamCompletion(ctx, messages, func(delta string) error {
		for _, s := range chunker.Feed(delta) {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case objQueue <- queuedObjection{chunk: s, index: index}:
				index++
			}
		}
		return nil
	}); err != nil {
		log.Printf("objection stream failed: %v", err)
		if ctx.Err() == nil {
			if standby := e.cfg.Load().Courtroom.StandbyObjection; standby != "" {
				pushObj(ai.SentenceChunk{Text: standby, Animation: "objection"})
			}
		}
	}
	if last := chunker.Flush(); last != nil {
		pushObj(*last)
	}
	close(objQueue)
	select {
	case <-ctx.Done():
	case <-objDone:
	}
}

// fallbackDefense feeds recent chat lines when the streamer stayed silent
func (e *Engine) fallbackDefense() string {
	if e.recall.Load() == nil {
		return e.cfg.Load().Courtroom.SilentDefense
	}
	lines := e.recall.Load().RecentComments(3)
	parts := make([]string, 0, len(lines))
	for _, l := range lines {
		author := l.Author
		if author == "" {
			author = "чат"
		}
		parts = append(parts, author+": "+html.UnescapeString(l.Text))
	}
	if len(parts) == 0 {
		return e.cfg.Load().Courtroom.SilentDefense
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

	// unwrap html entities before voice synthesis and display
	speechText := html.UnescapeString(s.Text)

	// strip SSML pause tags from subtitle display
	shown := strings.TrimSpace(ssmlDisplayRe.ReplaceAllString(speechText, ""))
	e.hub.BroadcastEvent(obs.EventSubtitles, obs.SubtitlesPayload{
		Speaker: speaker,
		Text:    shown,
	})

	if e.recall.Load() != nil {
		e.recall.Load().AddSpeechLine(shown)
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

// Say speaks immediately using the judge voice (gavel interjections).
// Interjections serialize among themselves and never claim stream end.
func (e *Engine) Say(text string) {
	clean := e.filter.Sanitize(text)
	if clean == "" {
		return
	}
	go func() {
		e.sayMu.Lock()
		defer e.sayMu.Unlock()
		ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()
		if err := e.speak(ctx, ai.SentenceChunk{Text: clean, Animation: "slam"}, -1, false,
			e.cfg.Load().Courtroom.JudgeName, e.castVoice(e.cfg.Load().TTS.JudgeVoice, e.cfg.Load().TTS.SileroJudge), e.cfg.Load().TTS.JudgeRate); err != nil {
			log.Printf("gavel interjection speech failed: %v", err)
		}
	}()
}

func (e *Engine) AddChatComment(author, text string) {
	if e.recall.Load() == nil {
		return
	}
	cleanAuthor := e.filter.Sanitize(author)
	cleanText := e.filter.Sanitize(text)
	e.recall.Load().AddComment(cleanAuthor, cleanText)
}

// AddWitness queues testimony; returns false when no trial is active
func (e *Engine) AddWitness(donor string, amount float64, currency, message string) bool {
	return e.addWitness(donor, amount, currency, message, false)
}

// AddFlaggedWitness queues testimony marked for the bench to condemn
func (e *Engine) AddFlaggedWitness(donor string, amount float64, currency, message string) bool {
	return e.addWitness(donor, amount, currency, message, true)
}

func (e *Engine) addWitness(donor string, amount float64, currency, message string, flagged bool) bool {
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
		Flagged:  flagged,
	}
	e.currCase.Witnesses = append(e.currCase.Witnesses, w)
	if len(e.currCase.Witnesses) > maxWitnesses {
		e.currCase.Witnesses = e.currCase.Witnesses[len(e.currCase.Witnesses)-maxWitnesses:]
	}

	if e.recall.Load() != nil {
		e.recall.Load().AddComment(cleanDonor, "свидетель: "+w.Message)
	}
	return true
}

func (e *Engine) buildWitnessInterlude(witnesses []Witness) string {
	if len(witnesses) == 0 {
		return ""
	}

	var sb strings.Builder
	if intro := e.cfg.Load().Courtroom.WitnessIntro; intro != "" {
		sb.WriteString(intro + " ")
	}
	for _, w := range witnesses {
		amount := strconv.FormatFloat(w.Amount, 'f', -1, 64)
		line := tmpl.Fill(e.cfg.Load().Courtroom.WitnessLine, map[string]string{
			"donor": w.Donor, "amount": amount, "currency": w.Currency,
			"message": truncateRunes(html.UnescapeString(w.Message), maxWitnessMessageRunes),
		})
		if strings.TrimSpace(line) != "" {
			sb.WriteString(line + " ")
		}
	}
	if outro := e.cfg.Load().Courtroom.WitnessOutro; outro != "" {
		sb.WriteString(outro)
	}
	return strings.TrimSpace(sb.String())
}

func truncateRunes(s string, max int) string {
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max]) + "..."
}

// truncateRunesTail preserves latest runes within the limit
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
	return e.buildWitnessInterlude(c.Witnesses)
}

// AddBribe puts donor money on the table; first offer per trial wins.
// The bench judges the offer, it never flips the verdict by itself.
func (e *Engine) AddBribe(donor string, amount float64, currency, message string) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.state == StateIdle || e.currCase == nil || e.currCase.Bribe != nil {
		return false
	}
	e.currCase.Bribe = &BribeOffer{
		Donor:    e.filter.Sanitize(donor),
		Amount:   amount,
		Currency: strings.TrimSpace(currency),
		Message:  e.filter.Sanitize(truncateRunes(message, 200)),
	}
	return true
}

// verdictSentence packs the penalty and the twist into one gavel line
func verdictSentence(prefix, penalty, twist string) string {
	parts := []string{}
	if penalty != "" {
		if prefix != "" {
			penalty = prefix + penalty
		}
		parts = append(parts, penalty+".")
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
	if c.Bribe != nil && !isGuilty {
		// the bench took the money: mark the acquittal, nothing more
		twist = e.cfg.Load().Courtroom.BribeTwist
	}
	if !decided {
		isGuilty = false
		if twist != "" {
			twist += " "
		}
		twist += e.cfg.Load().Courtroom.UndecidedTwist
	}
	twist = strings.TrimSpace(twist)
	verdictStr := "НЕВИНОВЕН"
	guiltyVotes := 0
	innocentVotes := 0
	totalVotes := 0
	if decided {
		totalVotes = 1
		if isGuilty {
			verdictStr = "ВИНОВЕН"
			guiltyVotes = 1
		} else {
			innocentVotes = 1
		}
	}
	witnessCount := len(c.Witnesses)
	defendant := c.Defendant
	crime := c.Crime
	viewer := html.UnescapeString(c.Viewer)
	penalty := ""
	punish := e.pendingPunishment
	courtCfg := e.cfg.Load().Courtroom
	if isGuilty && viewer != "" {
		switch punish.Kind {
		case "pardon":
			penalty = tmpl.Fill(courtCfg.PenaltyPardon, nil)
		case "ban":
			penalty = tmpl.Fill(courtCfg.PenaltyBan, nil)
		default:
			penalty = tmpl.Fill(courtCfg.PenaltyTimeout, map[string]string{"secs": strconv.Itoa(punish.Secs)})
		}
	} else if isGuilty && e.deck != nil {
		penalty = e.deck.Draw()
	}
	e.mu.Unlock()

	if e.recall.Load() != nil {
		summary := ""
		if lines := e.recall.Load().RecentComments(3); len(lines) > 0 {
			last := lines[len(lines)-1].Text
			if len([]rune(last)) > 140 {
				last = string([]rune(last)[:140]) + "..."
			}
			summary = last
		}
		e.recall.Load().AddTrial(memory.TrialRecord{
			Defendant: defendant,
			Crime:     crime,
			Verdict:   verdictStr,
			Guilty:    guiltyVotes,
			Innocent:  innocentVotes,
			Witnesses: witnessCount,
			Summary:   summary,
		})
		if e.recall.Load().OffenderCount(defendant) == 3 {
			e.recall.Load().NoteForAI(defendant + " в третий раз на скамье, зал помнит все прошлые выходки")
		}
		e.recall.Load().ClearTranscript()
	}

	// the ruling itself was spoken during deliberation: only the penalty lands now
	if sentence := verdictSentence(e.cfg.Load().Courtroom.PenaltyPrefix, penalty, twist); sentence != "" {
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
			// ban_confirm=true: verdict never auto-bans, streamer clicks it by hand
			if e.cfg.Load().Safety.BanConfirm {
				log.Printf("ban on %s needs manual confirm, skipping auto-ban", viewer)
				break
			}
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
