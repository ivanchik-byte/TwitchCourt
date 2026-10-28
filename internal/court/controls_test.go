package court

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"stream-tribunal/internal/audio"
	"stream-tribunal/internal/config"
	"stream-tribunal/internal/memory"
	"stream-tribunal/internal/obs"
	"stream-tribunal/internal/safety"
)

func awaitPhase(t *testing.T, engine *Engine, phase State) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for engine.GetState() != phase {
		if time.Now().After(deadline) {
			t.Fatalf("want %s, got %s", phase, engine.GetState())
		}
		time.Sleep(time.Millisecond)
	}
}

func TestViewerEvidenceReachesJudge(t *testing.T) {
	requests := make(chan string, 1)
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		select {
		case requests <- string(body):
		default:
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"choices":[{"message":{"content":"Назовите вашу версию событий."}}]}`)
	}))
	defer model.Close()
	cfg := config.DefaultConfig()
	cfg.AI.BaseURL, cfg.AI.Stream = model.URL, false
	voice, _ := audio.NewPiperDaemon(cfg.TTS)
	defer voice.Close()
	engine := NewEngine(cfg, obs.NewHub(nil), mustAIClient(t, cfg.AI), voice, safety.NewFilter(nil))
	if err := engine.StartViewerTrialWithContext("viewer", "Давал советы", "Улика: время в игре ноль минут"); err != nil {
		t.Fatal(err)
	}
	defer engine.TriggerPanic()
	select {
	case prompt := <-requests:
		if !strings.Contains(prompt, "время в игре ноль минут") {
			t.Fatal("viewer evidence was lost")
		}
		if strings.Contains(prompt, "Ты Прокурор трибунала") {
			t.Fatal("viewer trial used streamer prosecutor")
		}
	case <-time.After(time.Second):
		t.Fatal("model did not receive the case")
	}
}

func TestManualModerationSkipsAutomaticTimeout(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Safety.BanConfirm = true
	engine := NewEngine(cfg, obs.NewHub(nil), nil, nil, safety.NewFilter(nil))
	trial := &TrialCase{Defendant: "viewer", Viewer: "viewer"}
	engine.currCase = trial
	var called bool
	engine.TimeoutHook = func(string, int, bool, string) { called = true }
	done := make(chan struct{})
	go func() { engine.finalizeVerdict(context.Background(), trial, true, true); close(done) }()
	deadline := time.Now().Add(time.Second)
	for engine.Snapshot().Verdict == nil {
		if time.Now().After(deadline) {
			t.Fatal("verdict was not published")
		}
		time.Sleep(time.Millisecond)
	}
	if err := engine.AdvancePhase(StateVerdict); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("verdict did not finish")
	}
	if called {
		t.Fatal("manual moderation still timed out the viewer")
	}
}

func TestDemoAllModesWithoutExternalEffects(t *testing.T) {
	for _, mode := range []string{"viewer", "streamer", "unban"} {
		t.Run(mode, func(t *testing.T) {
			engine := NewEngine(nil, obs.NewHub(nil), nil, nil, safety.NewFilter(nil))
			recall := memory.NewStore("")
			engine.AttachMemory(recall)
			var effects atomic.Int32
			engine.VerdictHook = func(string, string, int, int, string) { effects.Add(1) }
			engine.TimeoutHook = func(string, int, bool, string) { effects.Add(1) }
			if err := engine.StartDemo(mode); err != nil {
				t.Fatal(err)
			}
			defer engine.TriggerPanic()
			if err := engine.StartDemo(mode); err == nil {
				t.Fatal("parallel demo was accepted")
			}
			for _, phase := range []State{StateIndictment, StateTestimony, StateDefense, StateObjection, StateVerdict} {
				awaitPhase(t, engine, phase)
				view := engine.Snapshot()
				if !view.Demo || view.Mode != mode || view.Defendant == "" || view.Line == "" {
					t.Fatalf("incomplete snapshot after reload: %+v", view)
				}
				if phase == StateVerdict && view.Verdict == nil {
					t.Fatal("missing verdict after reload")
				}
				if err := engine.AdvancePhase(phase); err != nil {
					t.Fatal(err)
				}
				if err := engine.AdvancePhase(phase); err == nil {
					t.Fatal("stale request advanced another phase")
				}
			}
			awaitPhase(t, engine, StateIdle)
			if effects.Load() != 0 || len(recall.RecentTrials(10)) != 0 {
				t.Fatal("rehearsal changed live moderation or history")
			}
		})
	}
}

func TestAdvanceEndsLiveInputWindows(t *testing.T) {
	engine := NewEngine(config.DefaultConfig(), obs.NewHub(nil), nil, nil, safety.NewFilter(nil))
	trial := &TrialCase{Defendant: "viewer"}
	engine.state, engine.currCase = StateIndictment, trial
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	done := make(chan string, 1)
	go func() {
		engine.runTestimonyWindow(ctx, trial)
		done <- engine.runDefenseWindow(ctx, trial)
	}()
	awaitPhase(t, engine, StateTestimony)
	if engine.Snapshot().TimeLeftSec <= 0 {
		t.Fatal("missing input timer")
	}
	if err := engine.AdvancePhase(StateTestimony); err != nil {
		t.Fatal(err)
	}
	awaitPhase(t, engine, StateDefense)
	if err := engine.AdvancePhase(StateTestimony); err == nil {
		t.Fatal("stale testimony advanced defense")
	}
	if !engine.AddDefense("стример", "У защиты есть алиби") {
		t.Fatal("defense rejected")
	}
	if err := engine.AdvancePhase(StateDefense); err != nil {
		t.Fatal(err)
	}
	select {
	case defense := <-done:
		if defense == "" {
			t.Fatal("early advance discarded the defense")
		}
	case <-ctx.Done():
		t.Fatal("operator could not end the input windows")
	}
}

func TestPanicCannotBeUndoneByOldDemo(t *testing.T) {
	engine := NewEngine(nil, obs.NewHub(nil), nil, nil, safety.NewFilter(nil))
	if err := engine.StartDemo("viewer"); err != nil {
		t.Fatal(err)
	}
	engine.TriggerPanic()
	if err := engine.StartDemo("streamer"); err != nil {
		t.Fatal(err)
	}
	defer engine.TriggerPanic()
	if err := engine.AdvancePhase(StateIndictment); err != nil {
		t.Fatal(err)
	}
	awaitPhase(t, engine, StateTestimony)
	if view := engine.Snapshot(); view.Mode != "streamer" || !view.Demo {
		t.Fatalf("old trial corrupted new one: %+v", view)
	}
}
