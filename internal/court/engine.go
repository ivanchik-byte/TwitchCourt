package court

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"sync"
	"time"

	"stream-tribunal/internal/ai"
	"stream-tribunal/internal/audio"
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
}

type Engine struct {
	cfg      *config.Config
	hub      *obs.Hub
	aiClient *ai.Client
	voice    audio.Synthesizer
	filter   *safety.Filter
	recall   *memory.Store
	mu       sync.RWMutex
	state    State
	currCase *TrialCase
	cancelFn context.CancelFunc
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

func (e *Engine) finalizeVerdict(ctx context.Context, c *TrialCase) {
	e.mu.Lock()
	e.state = StateVerdict
	isGuilty := c.GuiltyVotes > c.InnocentVotes
	verdictStr := "НЕВИНОВЕН"
	if isGuilty {
		verdictStr = "ВИНОВЕН"
	}
	totalVotes := c.GuiltyVotes + c.InnocentVotes
	guiltyVotes := c.GuiltyVotes
	innocentVotes := c.InnocentVotes
	defendant := c.Defendant
	crime := c.Crime
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
		Penalty:     "Штрафной ч/б фильтр вины в OBS",
	})

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
