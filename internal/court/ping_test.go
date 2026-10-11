package court

import (
	"context"
	"testing"

	"stream-tribunal/internal/ai"
	"stream-tribunal/internal/config"
	"stream-tribunal/internal/obs"
	"stream-tribunal/internal/safety"
)

func TestPingAIUnconfigured(t *testing.T) {
	e := NewEngine(nil, obs.NewHub(nil), mustAIClient(t, config.AIConfig{}), nil, safety.NewFilter(nil))
	if _, _, err := e.PingAI(context.Background()); err == nil {
		t.Fatal("unconfigured ai must fail the ping with setup hint")
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
