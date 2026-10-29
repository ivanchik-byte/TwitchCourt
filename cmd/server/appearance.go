package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"

	"stream-tribunal/internal/config"
	"stream-tribunal/internal/obs"
)

type appearanceSettings struct {
	Theme               string `json:"theme"`
	JudgePreset         string `json:"judge_preset"`
	ShowJudge           bool   `json:"show_judge"`
	ReduceMotion        bool   `json:"reduce_motion"`
	HasCustomJudge      bool   `json:"has_custom_judge"`
	HasCustomBackground bool   `json:"has_custom_background"`
	PhotoURL            string `json:"photo_url"`
	BackgroundURL       string `json:"background_url"`
}

func appearanceView(cfg *config.Config) appearanceSettings {
	view := appearanceSettings{Theme: cfg.Appearance.Theme, JudgePreset: cfg.Appearance.JudgePreset, ShowJudge: cfg.Appearance.ShowJudge, ReduceMotion: cfg.Appearance.ReduceMotion}
	if view.Theme != "graphite" && view.Theme != "slate" && view.Theme != "walnut" {
		view.Theme = "graphite"
	}
	var revision int64
	if info, err := os.Stat(judgePhotoPath()); err == nil {
		view.HasCustomJudge = true
		revision = info.ModTime().UnixNano()
	}
	var backdropRevision int64
	if photo, err := os.Stat(courtBgPath()); err == nil {
		view.HasCustomBackground = true
		backdropRevision = photo.ModTime().UnixNano()
	}
	view.BackgroundURL = fmt.Sprintf("/api/court/photo?v=%d", backdropRevision)
	if view.JudgePreset == "" {
		view.JudgePreset = "original"
		if view.HasCustomJudge {
			view.JudgePreset = "custom"
		}
	}
	view.PhotoURL = fmt.Sprintf("/api/judge/photo?preset=%s&v=%d", view.JudgePreset, revision)
	return view
}

func registerAppearance(mux *http.ServeMux, currentConfig func() *config.Config, publish func(http.ResponseWriter, *config.Config) bool, hub *obs.Hub) {
	mux.HandleFunc("/api/appearance", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case http.MethodGet:
			w.Header().Set("Cache-Control", "no-store")
			_ = json.NewEncoder(w).Encode(appearanceView(currentConfig()))
		case http.MethodPut:
			if !checkHTTPAuth(currentConfig(), r) {
				http.Error(w, "unauthorized", 401)
				return
			}
			var patch struct {
				Theme        *string `json:"theme"`
				JudgePreset  *string `json:"judge_preset"`
				ShowJudge    *bool   `json:"show_judge"`
				ReduceMotion *bool   `json:"reduce_motion"`
			}
			if err := decodeJSON(w, r, &patch); err != nil {
				http.Error(w, "bad request", 400)
				return
			}
			next := currentConfig().Clone()
			if patch.Theme != nil {
				switch *patch.Theme {
				case "graphite", "slate", "walnut":
					next.Appearance.Theme = *patch.Theme
				default:
					http.Error(w, "unknown theme", 400)
					return
				}
			}
			if patch.JudgePreset != nil {
				switch *patch.JudgePreset {
				case "original", "magistrate", "custom":
					next.Appearance.JudgePreset = *patch.JudgePreset
				default:
					http.Error(w, "unknown portrait", 400)
					return
				}
				if *patch.JudgePreset == "custom" && !appearanceView(next).HasCustomJudge {
					http.Error(w, "upload a portrait first", 400)
					return
				}
			}
			if patch.ShowJudge != nil {
				next.Appearance.ShowJudge = *patch.ShowJudge
			}
			if patch.ReduceMotion != nil {
				next.Appearance.ReduceMotion = *patch.ReduceMotion
			}
			if !publish(w, next) {
				return
			}
			view := appearanceView(next)
			hub.BroadcastEvent(obs.EventAppearance, view)
			_ = json.NewEncoder(w).Encode(view)
		default:
			http.Error(w, "method not allowed", 405)
		}
	})
}
