package court

import (
	"context"
	"testing"

	"stream-tribunal/internal/ai"
	"stream-tribunal/internal/config"
	"stream-tribunal/internal/obs"
	"stream-tribunal/internal/safety"
)

type castRecorder struct{ role string }

func (c *castRecorder) Synthesize(context.Context, string) ([]byte, error) { return nil, nil }
func (c *castRecorder) Close() error                                       { return nil }
func (c *castRecorder) SynthesizeRole(_ context.Context, _ string, role string) ([]byte, error) {
	c.role = role
	return make([]byte, 100), nil
}

func TestAccusersAndSpeechKeepTheirRole(t *testing.T) {
	voice := &castRecorder{}
	engine := NewEngine(config.DefaultConfig(), obs.NewHub(nil), nil, voice, safety.NewFilter(nil))
	for mode, want := range map[string]string{"viewer": "judge", "streamer": "prosecutor", "unban": "advocate"} {
		trial := &TrialCase{Mode: mode}
		role, name := engine.accuserRole(trial)
		if role != want {
			t.Fatalf("%s uses %s", mode, role)
		}
		engine.currCase = trial
		if err := engine.speakAs(context.Background(), ai.SentenceChunk{Text: "Суд слушает."}, 0, false, role, name, "", ""); err != nil {
			t.Fatal(err)
		}
		snapshot := engine.Snapshot()
		if voice.role != want || snapshot.Role != want || snapshot.Speaker != name {
			t.Fatalf("%s role lost during synthesis or reload", mode)
		}
	}
}
