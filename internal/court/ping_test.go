package court

import (
	"context"
	"testing"

	"stream-tribunal/internal/ai"
	"stream-tribunal/internal/config"
	"stream-tribunal/internal/obs"
	"stream-tribunal/internal/safety"
)

func TestPingAIMock(t *testing.T) {
	e := NewEngine(nil, obs.NewHub(nil), mustAIClient(t, config.AIConfig{}), nil, safety.NewFilter(nil))
	ms, mock, err := e.PingAI(context.Background())
	if err != nil {
		t.Fatalf("mock ping must not fail: %v", err)
	}
	if !mock {
		t.Fatal("keyless client must report mock")
	}
	if ms != 0 {
		t.Fatalf("mock ping must be instant, got %dms", ms)
	}
}

func TestPingAINoClient(t *testing.T) {
	e := newWitnessEngine()
	if _, _, err := e.PingAI(context.Background()); err == nil {
		t.Fatal("missing client must fail the ping")
	}
}

func mustAIClient(t *testing.T, cfg config.AIConfig) *ai.Client {
	t.Helper()
	c, err := ai.NewClient(cfg)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestStartUnbanTrialBusy(t *testing.T) {
	e := newWitnessEngine()
	e.mu.Lock()
	e.state = StateIndictment
	e.mu.Unlock()
	if err := e.StartUnbanTrial("banned_viewer", "прошу разбан"); err == nil {
		t.Fatal("busy court must reject the unban trial")
	}
}
