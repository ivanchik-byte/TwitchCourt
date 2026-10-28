package main

import (
	"encoding/json"
	"errors"
	"net/http"

	"stream-tribunal/internal/config"
	"stream-tribunal/internal/court"
)

func writeTrialError(w http.ResponseWriter, err error) {
	w.Header().Set("Content-Type", "application/json")
	status, code := http.StatusConflict, "court_busy"
	if errors.Is(err, court.ErrAINotConfigured) {
		status, code = http.StatusPreconditionFailed, "ai_not_configured"
	}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"code": code})
}

func registerShowControls(mux *http.ServeMux, currentConfig func() *config.Config, engine *court.Engine) {
	registerQueue(mux, currentConfig, engine)
	mux.HandleFunc("/api/tts/preview", voicePreview(currentConfig, engine))
	mux.HandleFunc("/api/demo", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !checkHTTPAuth(currentConfig(), r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req struct {
			Mode string `json:"mode"`
		}
		if err := decodeJSON(w, r, &req); err != nil || (req.Mode != "viewer" && req.Mode != "streamer" && req.Mode != "unban") {
			http.Error(w, "unknown demo mode", http.StatusBadRequest)
			return
		}
		if err := engine.StartDemo(req.Mode); err != nil {
			writeTrialError(w, err)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	})

	mux.HandleFunc("/api/trial/advance", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !checkHTTPAuth(currentConfig(), r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req struct {
			Phase court.State `json:"phase"`
		}
		if err := decodeJSON(w, r, &req); err != nil || req.Phase == "" {
			http.Error(w, "phase is required", http.StatusBadRequest)
			return
		}
		if err := engine.AdvancePhase(req.Phase); err != nil {
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	})
}
