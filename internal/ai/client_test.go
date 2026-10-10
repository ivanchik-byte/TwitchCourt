package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"stream-tribunal/internal/config"
)

func TestResolveEndpoint(t *testing.T) {
	for _, tc := range []struct {
		provider, base, want string
	}{
		{"groq", "", "https://api.groq.com/openai/v1/chat/completions"},
		{"", "", "https://api.groq.com/openai/v1/chat/completions"},
		{"cerebras", "", "https://api.cerebras.ai/v1/chat/completions"},
		{"ollama", "", "http://localhost:11434/v1/chat/completions"},
		{"custom", "https://llm.onerouter.pro/v1", "https://llm.onerouter.pro/v1/chat/completions"},
		{"custom", "https://llm.onerouter.pro/v1/", "https://llm.onerouter.pro/v1/chat/completions"},
		{"custom", "https://host/v1/chat/completions", "https://host/v1/chat/completions"},
		{"custom", "https://host/base", "https://host/base/v1/chat/completions"},
		{"ollama", "http://box:11434/v1/chat/completions", "http://box:11434/v1/chat/completions"},
	} {
		got, err := ResolveEndpoint(tc.provider, tc.base)
		if err != nil {
			t.Fatalf("provider %q base %q: %v", tc.provider, tc.base, err)
		}
		if got != tc.want {
			t.Fatalf("provider %q base %q: want %q, got %q", tc.provider, tc.base, tc.want, got)
		}
	}
	if _, err := ResolveEndpoint("mystery", ""); err == nil {
		t.Fatal("unknown provider without base_url must fail loudly, not silently use groq")
	}
}

func TestMergeExtraBody(t *testing.T) {
	raw := []byte(`{"model":"m","messages":[],"temperature":0.5,"stream":true}`)
	merged, err := mergeExtraBody(raw, map[string]any{
		"model":    "evil-override",
		"provider": map[string]any{"service_tier": "standard"},
	})
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	if err := json.Unmarshal(merged, &body); err != nil {
		t.Fatal(err)
	}
	if body["model"] != "m" {
		t.Fatalf("standard fields must win, got %v", body["model"])
	}
	provider, ok := body["provider"].(map[string]any)
	if !ok || provider["service_tier"] != "standard" {
		t.Fatalf("extra params must land in root: %v", body["provider"])
	}
	if out, err := mergeExtraBody(raw, nil); err != nil || string(out) != string(raw) {
		t.Fatal("empty extra must pass the body through")
	}
}

func TestMockRule(t *testing.T) {
	keylessCustom, err := NewClient(config.AIConfig{Provider: "custom", BaseURL: "http://box:1234/v1"})
	if err != nil {
		t.Fatal(err)
	}
	if keylessCustom.IsMock() {
		t.Fatal("keyless custom with base_url is a live local server, not mock")
	}
	keylessKnown, err := NewClient(config.AIConfig{Provider: "groq"})
	if err != nil {
		t.Fatal(err)
	}
	if !keylessKnown.IsMock() {
		t.Fatal("keyless groq without base_url must stay mock")
	}
}

func TestCloneIndependence(t *testing.T) {
	orig := config.DefaultConfig()
	orig.AI.ExtraBody = map[string]any{"provider": map[string]any{"service_tier": "standard"}}
	next := orig.Clone()
	next.AI.ExtraBody["provider"].(map[string]any)["service_tier"] = "mutated"
	if orig.AI.ExtraBody["provider"].(map[string]any)["service_tier"] != "standard" {
		t.Fatal("Clone must deep-copy ExtraBody for RCU safety")
	}
}

func TestExtraBodyReachesWire(t *testing.T) {
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}]}`))
	}))
	defer srv.Close()

	cfg := config.AIConfig{
		Provider: "custom", APIKey: "k", Model: "m", Stream: false,
		BaseURL:   srv.URL,
		ExtraBody: map[string]any{"provider": map[string]any{"service_tier": "standard"}},
	}
	c, err := NewClient(cfg)
	if err != nil {
		t.Fatal(err)
	}
	var text string
	if err := c.StreamCompletion(context.Background(), []ChatMessage{{Role: "user", Content: "hi"}}, func(s string) error {
		text += s
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if text != "ok" {
		t.Fatalf("want ok, got %q", text)
	}
	if !strings.Contains(c.endpoint, srv.URL) {
		t.Fatalf("custom endpoint must hit the test server, got %q", c.endpoint)
	}
	provider, ok := gotBody["provider"].(map[string]any)
	if !ok || provider["service_tier"] != "standard" {
		t.Fatalf("wire body misses extra params: %v", gotBody)
	}
	if gotBody["model"] != "m" || gotBody["stream"] != false {
		t.Fatalf("standard fields must survive merge: %v", gotBody)
	}
}
