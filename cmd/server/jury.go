package main

import (
	"encoding/json"
	"net/http"

	"stream-tribunal/internal/config"
	"stream-tribunal/internal/court"
)

func registerJury(mux *http.ServeMux, currentConfig func() *config.Config, engine *court.Engine) {
	mux.HandleFunc("/api/jury", func(w http.ResponseWriter, r *http.Request) {
		if !checkHTTPAuth(currentConfig(), r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			_ = json.NewEncoder(w).Encode(engine.JurySnapshot())
			return
		}
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var request struct {
			Epoch    string `json:"epoch"`
			TrialID  uint64 `json:"trial_id"`
			Revision uint64 `json:"revision"`
			Action   string `json:"action"`
			Round    int    `json:"round"`
			Seconds  int    `json:"seconds"`
			PollID   string `json:"poll_id"`
		}
		if err := decodeJSON(w, r, &request); err != nil || request.Epoch == "" || request.TrialID == 0 || (request.Action != "open" && request.Action != "close") {
			http.Error(w, "epoch, trial id and ballot action required", http.StatusBadRequest)
			return
		}
		if request.Action == "open" && (request.Round < 1 || request.Round > 2 || request.Seconds < 5 || request.Seconds > 60) {
			http.Error(w, "round must be 1 or 2; duration must be 5–60 seconds", http.StatusBadRequest)
			return
		}
		if request.Action == "close" && request.PollID == "" {
			http.Error(w, "poll id required", http.StatusBadRequest)
			return
		}
		if request.Action == "open" {
			view, err := engine.OpenJury(request.Epoch, request.TrialID, request.Revision, request.Round, request.Seconds)
			if err != nil {
				http.Error(w, err.Error(), http.StatusConflict)
				return
			}
			_ = json.NewEncoder(w).Encode(view)
			return
		}
		view, err := engine.CloseJury(request.Epoch, request.TrialID, request.PollID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		_ = json.NewEncoder(w).Encode(view)
	})
	mux.HandleFunc("/api/jury/test-vote", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !checkHTTPAuth(currentConfig(), r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var request struct {
			Epoch   string `json:"epoch"`
			TrialID uint64 `json:"trial_id"`
			PollID  string `json:"poll_id"`
			Nick    string `json:"nick"`
			Choice  string `json:"choice"`
		}
		if err := decodeJSON(w, r, &request); err != nil || request.Epoch == "" || request.TrialID == 0 || request.PollID == "" {
			http.Error(w, "bound rehearsal vote required", http.StatusBadRequest)
			return
		}
		view, err := engine.TestJuryVote(request.Epoch, request.TrialID, request.PollID, request.Nick, request.Choice)
		if err != nil {
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(view)
	})
}
