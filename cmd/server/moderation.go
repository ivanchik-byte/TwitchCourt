package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"stream-tribunal/internal/bot"
	"stream-tribunal/internal/config"
)

func moderationHandler(current func() *config.Config, moderate func(context.Context, string, string, int, string) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", 405)
			return
		}
		if !checkHTTPAuth(current(), r) {
			http.Error(w, "unauthorized", 401)
			return
		}
		var req struct {
			User   string `json:"user"`
			Action string `json:"action"`
			Secs   int    `json:"secs"`
			Reason string `json:"reason"`
		}
		if decodeJSON(w, r, &req) != nil || !validNick.MatchString(req.User) {
			http.Error(w, "bad request", 400)
			return
		}
		if req.Action != "ban" && req.Action != "timeout" && req.Action != "pardon" {
			http.Error(w, "unknown moderation action", 400)
			return
		}
		if req.Secs <= 0 {
			req.Secs = 60
		}
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		w.Header().Set("Content-Type", "application/json")
		if err := moderate(ctx, req.User, req.Action, req.Secs, req.Reason); err != nil {
			status := http.StatusBadGateway
			if errors.Is(err, bot.ErrModerationNotConfigured) {
				status = http.StatusPreconditionFailed
			}
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "confirmed": true})
	}
}
