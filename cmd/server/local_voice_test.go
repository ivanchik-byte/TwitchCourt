package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"stream-tribunal/internal/config"
)

func TestLocalVoiceRequiresAuthBeforeCheckingOrLaunching(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Server.Secret = "secret"
	mux := http.NewServeMux()
	service := registerLocalVoice(mux, func() *config.Config { return cfg }, nil)
	defer service.Close()
	for _, method := range []string{"GET", "POST"} {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest(method, "/api/tts/local", nil))
		if w.Code != 401 || service.cmd != nil {
			t.Fatalf("unauthenticated %s reached local service", method)
		}
	}
	request := httptest.NewRequest("DELETE", "/api/tts/local", nil)
	request.Header.Set("X-Tribunal-Secret", "secret")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, request)
	if w.Code != 405 {
		t.Fatal("wrong method accepted")
	}
}
