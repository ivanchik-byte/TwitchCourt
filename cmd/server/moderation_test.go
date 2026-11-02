package main

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"stream-tribunal/internal/bot"
	"stream-tribunal/internal/config"
	"testing"
)

func TestModerationDoesNotConfirmAnOfflineCommand(t *testing.T) {
	cfg := config.DefaultConfig()
	handler := moderationHandler(func() *config.Config { return cfg }, func(context.Context, string, string, int, string) error { return bot.ErrModerationNotConfigured })
	w := httptest.NewRecorder()
	handler(w, httptest.NewRequest(http.MethodPost, "/api/moderate", bytes.NewBufferString(`{"user":"viewer","action":"timeout","secs":60}`)))
	if w.Code != http.StatusPreconditionFailed {
		t.Fatalf("offline moderation status %d: %s", w.Code, w.Body.String())
	}
}
