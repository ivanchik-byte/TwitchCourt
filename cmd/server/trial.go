package main

import (
	"net/http"

	"stream-tribunal/internal/config"
	"stream-tribunal/internal/court"
)

func trialHandler(currentConfig func() *config.Config, engine *court.Engine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !checkHTTPAuth(currentConfig(), r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req struct {
			CaseID    string `json:"case_id"`
			Defendant string `json:"defendant"`
			Crime     string `json:"crime"`
			Context   string `json:"context"`
			Viewer    bool   `json:"viewer"`
		}
		if err := decodeJSON(w, r, &req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		req.Defendant = truncateRunes(req.Defendant, 64)
		req.Crime = truncateRunes(req.Crime, 300)
		req.Context = truncateRunes(req.Context, 1000)
		if req.Defendant == "" {
			req.Defendant = currentConfig().Game.StreamerName
		}
		if req.Crime == "" && req.CaseID == "" {
			req.Crime = currentConfig().Chat.DefaultCrime
		}
		var trialErr error
		if req.CaseID != "" {
			deck := engine.CaseDeck()
			var selected *court.CaseCard
			if deck != nil {
				for _, card := range deck.List() {
					if card.ID == req.CaseID {
						candidate := card
						selected = &candidate
						break
					}
				}
			}
			if selected == nil {
				http.Error(w, "case not found", 404)
				return
			}
			if req.Crime != "" {
				selected.Crime = req.Crime
			}
			if req.Context != "" {
				selected.Context = req.Context
			}
			trialErr = engine.StartCaseTrial(req.Defendant, *selected, req.Viewer)
		} else if req.Viewer {
			trialErr = engine.StartViewerTrialWithContext(req.Defendant, req.Crime, req.Context)
		} else {
			trialErr = engine.StartTrial(req.Defendant, req.Crime, req.Context)
		}
		if trialErr != nil {
			writeTrialError(w, trialErr)
			return
		}
		if req.CaseID != "" {
			engine.CaseDeck().Use(req.CaseID)
			go engine.EnsureRefill()
		}
		if req.Viewer {
			engine.LeavePool(req.Defendant)
		}
		w.WriteHeader(http.StatusAccepted)
	}
}
