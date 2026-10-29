package main

import (
	"encoding/json"
	"fmt"
	"net/http"

	"stream-tribunal/internal/config"
	"stream-tribunal/internal/court"
)

func limitCaseMaterials(card *court.CaseCard) error {
	card.Title = truncateRunes(card.Title, 120)
	card.Crime = truncateRunes(card.Crime, 300)
	card.Context = truncateRunes(card.Context, 1000)
	card.Details = truncateRunes(card.Details, 5000)
	card.DefenseExample = truncateRunes(card.DefenseExample, 1000)
	card.Dilemma = truncateRunes(card.Dilemma, 500)
	card.Question = truncateRunes(card.Question, 500)
	if len(card.Exhibits) > 3 {
		return fmt.Errorf("at most three exhibits per case")
	}
	for i := range card.Exhibits {
		card.Exhibits[i].Title = truncateRunes(card.Exhibits[i].Title, 80)
		card.Exhibits[i].Text = truncateRunes(card.Exhibits[i].Text, 500)
		if card.Exhibits[i].Title == "" || card.Exhibits[i].Text == "" {
			return fmt.Errorf("exhibit title and text are required")
		}
	}
	return nil
}

func registerCasePacks(mux *http.ServeMux, currentConfig func() *config.Config, engine *court.Engine) {
	mux.HandleFunc("/api/cases/packs", func(w http.ResponseWriter, r *http.Request) {
		if !checkHTTPAuth(currentConfig(), r) {
			http.Error(w, "unauthorized", 401)
			return
		}
		deck := engine.CaseDeck()
		if deck == nil {
			http.Error(w, "case deck unavailable", 503)
			return
		}
		packs, err := court.CasePacks()
		if err != nil {
			http.Error(w, "case packs unavailable", 500)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case http.MethodGet:
			known := map[string]bool{}
			for _, card := range deck.List() {
				known[card.ID] = true
			}
			type packView struct {
				ID          string   `json:"id"`
				Title       string   `json:"title"`
				Description string   `json:"description"`
				Titles      []string `json:"titles"`
				Installed   int      `json:"installed"`
			}
			views := make([]packView, 0, len(packs))
			for _, pack := range packs {
				view := packView{ID: pack.ID, Title: pack.Title, Description: pack.Description}
				for _, card := range pack.Cases {
					view.Titles = append(view.Titles, card.Title)
					if known[card.ID] {
						view.Installed++
					}
				}
				views = append(views, view)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"packs": views})
		case http.MethodPost:
			var request struct {
				ID string `json:"id"`
			}
			if err := decodeJSON(w, r, &request); err != nil || request.ID == "" {
				http.Error(w, "pack id required", 400)
				return
			}
			for _, pack := range packs {
				if pack.ID != request.ID {
					continue
				}
				added, err := deck.ImportPack(pack)
				if err != nil {
					http.Error(w, "could not save case pack", 500)
					return
				}
				_ = json.NewEncoder(w).Encode(map[string]int{"added": added, "skipped": len(pack.Cases) - added})
				return
			}
			http.Error(w, "case pack not found", 404)
		default:
			http.Error(w, "method not allowed", 405)
		}
	})
}
