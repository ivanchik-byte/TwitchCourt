package main

import (
	"encoding/json"
	"net/http"

	"stream-tribunal/internal/config"
	"stream-tribunal/internal/court"
)

func registerQueue(mux *http.ServeMux, currentConfig func() *config.Config, engine *court.Engine) {
	mux.HandleFunc("/api/dock/entry", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost && r.Method != http.MethodDelete {
			http.Error(w, "method not allowed", 405)
			return
		}
		if !checkHTTPAuth(currentConfig(), r) {
			http.Error(w, "unauthorized", 401)
			return
		}
		var req struct {
			Nick   string `json:"nick"`
			Reason string `json:"reason"`
		}
		if err := decodeJSON(w, r, &req); err != nil || !validNick.MatchString(req.Nick) {
			http.Error(w, "valid Twitch nick is required", 400)
			return
		}
		if r.Method == http.MethodDelete {
			if !engine.LeavePool(req.Nick) {
				http.Error(w, "entry not found", 404)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		joined, position := engine.JoinPool(req.Nick, req.Reason)
		if !joined && position == 0 {
			http.Error(w, "queue is closed or full", 409)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"joined": joined, "position": position})
	})
}
