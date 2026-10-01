package court

import (
	"context"
	"encoding/base64"
	"fmt"
	"html"
	"log"
	"strconv"
	"strings"
	"sync"
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
	StateIdle       State = "idle"
	StateIndictment State = "indictment"
	StateDefense    State = "defense"
	StateObjection  State = "objection"
	StateVoting     State = "voting"
	StateVerdict    State = "verdict"
)

type TrialCase struct {
	Defendant     string
	Crime         string
	ChatContext   string
	GuiltyVotes   int
	InnocentVotes int
	Voters        map[string]bool
	Witnesses     []Witness
}

// Witness is a donation attached to the running trial as testimony.
// It never interrupts speech, it is read out between prosecutor lines.
type Witness struct {
	Donor    string
	Amount   float64
	Currency string
	Message  string
}

// maxWitnessWeight caps how many guilty points testimony can add,
// so a single whale cannot decide the verdict alone.
const maxWitnessWeight = 3

// maxWitnessMessageRunes caps a single testimony line for speech.
const maxWitnessMessageRunes = 140

type Engine struct {
	cfg      *config.Config
	hub      *obs.Hub
	aiClient *ai.Client
	voice    audio.Synthesizer
	filter   *safety.Filter
	recall   *memory.Store
	deck     *bot.Deck
	// VerdictHook runs after the verdict broadcast, used for chat announces.
	VerdictHook func(verdict, penalty string, guilty, innocent int)
	mu          sync.RWMutex
	state       State
	currCase    *TrialCase
	cancelFn    context.CancelFunc
}

func NewEngine(cfg *config.Config, hub *obs.Hub, aiClient *ai.Client, voice audio.Synthesizer, filter *safety.Filter) *Engine {
	return &Engine{
		cfg:      cfg,
		hub:      hub,
		aiClient: aiClient,
		voice:    voice,
		filter:   filter,
		recall:   memory.NewStore(""),
		state:    StateIdle,
	}
}

// AttachMemory swaps the in-memory recall store for a persistent one.
func (e *Engine) AttachMemory(store *memory.Store) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if store != nil {
		e.recall = store
	}
}

// SetPunishments replaces the guilty-verdict punishment deck.
func (e *Engine) SetPunishments(items []string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.deck = bot.NewDeck(items)
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
		Voters:      make(map[string]bool),
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
		{Role: "system", Content: ai.SystemProsecutorPrompt},
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
			if err := e.dispatchSpeechChunk(ctx, item.chunk, item.index, item.last); err != nil {
				return
			}
		}
	}()

	chunker := ai.NewSentenceChunker()
	chunkIndex := 0

	err := e.aiClient.StreamCompletion(ctx, messages, func(delta string) error {
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

	if err == nil {
		if last := chunker.Flush(); last != nil {
			select {
			case <-ctx.Done():
			case speechQueue <- queued{chunk: *last, index: chunkIndex, last: true}:
			}
		}
	}
	close(speechQueue)

	select {
	case <-ctx.Done():
		return
	case <-speechDone:
	}

	// Witness interlude: testimony queued during the indictment is read
	// out as a separate beat before voting, speech is never interrupted.
	if interlude := e.drainWitnessInterlude(c); interlude != "" {
		_ = e.dispatchSpeechChunk(ctx, ai.SentenceChunk{Text: interlude, Animation: "slam"}, chunkIndex, false)
	}

	select {
	case <-ctx.Done():
		return
	case <-time.After(2 * time.Second):
	}

	e.startVoting(ctx, c)
	e.clearTrial()
}

// clearTrial releases the trial cancel func after a normal finish.
func (e *Engine) clearTrial() {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.state == StateIdle && e.cancelFn != nil {
		e.cancelFn()
		e.cancelFn = nil
	}
}

func (e *Engine) dispatchSpeechChunk(ctx context.Context, s ai.SentenceChunk, index int, isLast bool) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	if s.Animation != "" {
		e.hub.BroadcastEvent(obs.EventAnimation, obs.AnimationPayload{Name: s.Animation})
	}

	e.hub.BroadcastEvent(obs.EventSubtitles, obs.SubtitlesPayload{
		Speaker: e.cfg.Courtroom.ProsecutorName,
		Text:    s.Text,
	})

	if e.recall != nil {
		e.recall.AddSpeechLine(s.Text)
	}

	synthCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	rawBytes, err := e.voice.Synthesize(synthCtx, s.Text)
	if err != nil {
		log.Printf("tts synthesis error: %v", err)
		return nil
	}
	if len(rawBytes) == 0 {
		return nil
	}

	b64Audio := base64.StdEncoding.EncodeToString(rawBytes)
	e.hub.BroadcastEvent(obs.EventAudioChunk, obs.AudioChunkPayload{
		Index:       index,
		AudioBase64: b64Audio,
		Text:        s.Text,
		IsLast:      isLast,
	})

	return nil
}

func (e *Engine) startVoting(ctx context.Context, c *TrialCase) {
	e.mu.Lock()
	e.state = StateVoting
	duration := e.cfg.Courtroom.VotingDurationSec
	if duration <= 0 {
		duration = 30
	}
	e.mu.Unlock()

	e.hub.BroadcastEvent(obs.EventStateChange, obs.StateChangePayload{
		State:       string(StateVoting),
		TimeLeftSec: duration,
	})

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for remaining := duration; remaining >= 0; remaining-- {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			e.mu.RLock()
			guilty := c.GuiltyVotes
			innocent := c.InnocentVotes
			e.mu.RUnlock()

			e.hub.BroadcastEvent(obs.EventVotingUpdate, obs.VotingUpdatePayload{
				GuiltyCount:   guilty,
				InnocentCount: innocent,
				TimeLeftSec:   remaining,
			})
		}
	}

	e.finalizeVerdict(ctx, c)
}

func (e *Engine) CastVote(voter string, isGuilty bool) {
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.state != StateVoting || e.currCase == nil {
		return
	}

	if e.currCase.Voters[voter] {
		return
	}

	e.currCase.Voters[voter] = true
	if isGuilty {
		e.currCase.GuiltyVotes++
	} else {
		e.currCase.InnocentVotes++
	}

	if e.recall != nil {
		e.recall.AddVote(voter)
	}
}

// AddChatComment stores a chat line for the live trial transcript.
func (e *Engine) AddChatComment(author, text string) {
	if e.recall == nil {
		return
	}
	cleanAuthor := e.filter.Sanitize(author)
	cleanText := e.filter.Sanitize(text)
	e.recall.AddComment(cleanAuthor, cleanText)
}

// AddWitness attaches a donation to the running trial as testimony.
// It returns false when no trial is in session, so the caller can
// open a fresh trial instead. Testimony never interrupts speech,
// it is read out between prosecutor lines and adds weight to guilty.
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

	if e.recall != nil {
		e.recall.AddComment(cleanDonor, "свидетель: "+w.Message)
	}
	return true
}

// witnessWeight converts testimony into guilty points, capped.
func witnessWeight(witnesses []Witness) int {
	if len(witnesses) > maxWitnessWeight {
		return maxWitnessWeight
	}
	return len(witnesses)
}

// buildWitnessInterlude renders queued testimony as one prosecutor line.
// Pure function, safe to unit test without TTS or network.
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

// drainWitnessInterlude snapshots queued testimony for the interlude beat.
func (e *Engine) drainWitnessInterlude(c *TrialCase) string {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return buildWitnessInterlude(c.Witnesses)
}

func (e *Engine) finalizeVerdict(ctx context.Context, c *TrialCase) {
	e.mu.Lock()
	e.state = StateVerdict
	weight := witnessWeight(c.Witnesses)
	effectiveGuilty := c.GuiltyVotes + weight
	isGuilty := effectiveGuilty > c.InnocentVotes
	verdictStr := "НЕВИНОВЕН"
	if isGuilty {
		verdictStr = "ВИНОВЕН"
	}
	totalVotes := c.GuiltyVotes + c.InnocentVotes
	guiltyVotes := c.GuiltyVotes
	innocentVotes := c.InnocentVotes
	witnessCount := len(c.Witnesses)
	defendant := c.Defendant
	crime := c.Crime
	penalty := ""
	if isGuilty && e.deck != nil {
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

	e.hub.BroadcastEvent(obs.EventVerdict, obs.VerdictPayload{
		Verdict:     verdictStr,
		GuiltyVotes: guiltyVotes,
		TotalVotes:  totalVotes,
		Witnesses:   witnessCount,
		Penalty:     penalty,
	})

	if e.VerdictHook != nil {
		e.VerdictHook(verdictStr, penalty, guiltyVotes, innocentVotes)
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
