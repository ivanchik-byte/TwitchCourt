package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"stream-tribunal/internal/config"
	"stream-tribunal/internal/court"
	"stream-tribunal/internal/obs"
	"stream-tribunal/internal/safety"
)

func TestTrialSetupErrorIsNotBusy(t *testing.T) {
	w := httptest.NewRecorder()
	writeTrialError(w, court.ErrAINotConfigured)
	if w.Code != http.StatusPreconditionFailed || !strings.Contains(w.Body.String(), "ai_not_configured") {
		t.Fatalf("missing AI was reported as busy: %d %s", w.Code, w.Body.String())
	}
}

func TestVoicePreviewDoesNotSaveOrFallBack(t *testing.T) {
	for _, available := range []bool{true, false} {
		t.Run(map[bool]string{true: "available", false: "offline"}[available], func(t *testing.T) {
			var speaker string
			voiceService := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var request struct {
					Speaker string `json:"speaker"`
				}
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Error(err)
				}
				speaker = request.Speaker
				if !available {
					w.WriteHeader(http.StatusServiceUnavailable)
					return
				}
				_, _ = w.Write(append([]byte("RIFF"), make([]byte, 100)...))
			}))
			defer voiceService.Close()
			cfg := config.DefaultConfig()
			cfg.TTS.SileroURL = voiceService.URL
			engine := court.NewEngine(cfg, obs.NewHub(nil), nil, nil, safety.NewFilter(nil))
			request := httptest.NewRequest(http.MethodPost, "/api/tts/preview", strings.NewReader(`{"engine":"silero","voice":"eugene"}`))
			w := httptest.NewRecorder()
			voicePreview(func() *config.Config { return cfg }, engine)(w, request)
			want := http.StatusBadGateway
			if available {
				want = http.StatusOK
			}
			if w.Code != want {
				t.Fatalf("want %d, got %d: %s", want, w.Code, w.Body.String())
			}
			if speaker != "eugene" || cfg.TTS.SileroJudge == "eugene" || cfg.TTS.Engine != "edge" {
				t.Fatal("preview used the wrong speaker or changed the saved configuration")
			}
			if available && w.Header().Get("Content-Type") != "audio/wav" {
				t.Fatal("WAV preview has wrong media type")
			}
		})
	}
}

func TestShowControlsAuthenticationAndValidation(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Server.Secret = "test-secret"
	engine := court.NewEngine(cfg, obs.NewHub(nil), nil, nil, safety.NewFilter(nil))
	defer engine.TriggerPanic()
	mux := http.NewServeMux()
	registerShowControls(mux, func() *config.Config { return cfg }, engine)
	for _, tc := range []struct {
		path, body, secret string
		status             int
	}{
		{"/api/demo", `{"mode":"viewer"}`, "", 401},
		{"/api/trial/advance", `{"phase":"defense"}`, "wrong", 401},
		{"/api/demo", `{"mode":"invalid"}`, "test-secret", 400},
		{"/api/demo", `{"mode":"viewer","unexpected":true}`, "test-secret", 400},
		{"/api/trial/advance", `{}`, "test-secret", 400},
		{"/api/tts/preview", `{"engine":"silero","voice":"kseniya"}`, "", 401},
		{"/api/tts/preview", `{"engine":"mock"}`, "test-secret", 412},
		{"/api/demo", `{"mode":"viewer"}`, "test-secret", 202},
		{"/api/demo", `{"mode":"streamer"}`, "test-secret", 409},
	} {
		req := httptest.NewRequest(http.MethodPost, tc.path, bytes.NewBufferString(tc.body))
		req.Header.Set("X-Tribunal-Secret", tc.secret)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		if w.Code != tc.status {
			t.Fatalf("%s %s: want %d, got %d %s", tc.path, tc.body, tc.status, w.Code, w.Body.String())
		}
	}
}
