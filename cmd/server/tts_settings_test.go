package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"stream-tribunal/internal/config"
	"stream-tribunal/internal/court"
	"stream-tribunal/internal/obs"
	"stream-tribunal/internal/safety"
)

func TestTTSKeepsKeyServerSideAndPreservesOmittedKey(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Server.Secret = "control-secret"
	engine := court.NewEngine(cfg, obs.NewHub(nil), nil, nil, safety.NewFilter(nil))
	mux := http.NewServeMux()
	swaps := 0
	registerTTS(mux, func() *config.Config { return cfg }, func(_ http.ResponseWriter, next *config.Config) bool { cfg = next; return true }, engine, func(*config.Config) { swaps++ })
	for _, step := range []struct {
		method, body string
		auth         bool
		code         int
	}{
		{"PUT", `{"engine":"elevenlabs","eleven_api_key":"private-voice-key"}`, false, 401},
		{"PUT", `{"engine":"elevenlabs","eleven_api_key":"private-voice-key","eleven_voice_id":"voice-1","eleven_model_id":"eleven_multilingual_v2","roles":{"prosecutor":{"eleven_voice_id":"prosecutor-id"}},"delivery":"expressive"}`, true, 200},
		{"GET", "", true, 200},
		{"PUT", `{"engine":"elevenlabs","eleven_voice_id":"voice-2"}`, true, 200},
		{"PUT", `{"engine":"bad"}`, true, 400},
		{"PUT", `{"unknown":true}`, true, 400},
		{"PUT", `{"roles":{"invented":{}}}`, true, 400},
		{"PUT", `{"delivery":"unknown"}`, true, 400},
	} {
		request := httptest.NewRequest(step.method, "/api/tts", strings.NewReader(step.body))
		if step.auth {
			request.Header.Set("X-Tribunal-Secret", "control-secret")
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, request)
		if w.Code != step.code {
			t.Fatalf("%s: want %d got %d", step.method, step.code, w.Code)
		}
		if strings.Contains(w.Body.String(), "private-voice-key") || strings.Contains(w.Body.String(), `"eleven_api_key"`) {
			t.Fatal("speech credentials leaked into settings response")
		}
	}
	if cfg.TTS.Roles["prosecutor"].ElevenVoiceID != "prosecutor-id" || cfg.TTS.Delivery != "expressive" {
		t.Fatal("role or delivery was not saved")
	}
	if cfg.TTS.ElevenAPIKey != "private-voice-key" || cfg.TTS.ElevenVoiceID != "voice-2" || swaps != 2 {
		t.Fatal("saved key was lost or voice was not refreshed")
	}
	if err := engine.StartDemo("viewer"); err != nil {
		t.Fatal(err)
	}
	defer engine.TriggerPanic()
	request := httptest.NewRequest("PUT", "/api/tts", strings.NewReader(`{"engine":"mock"}`))
	request.Header.Set("X-Tribunal-Secret", "control-secret")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, request)
	if w.Code != 409 || swaps != 2 {
		t.Fatal("voice changed during an active trial")
	}
}
