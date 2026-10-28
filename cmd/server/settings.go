package main

import (
	"encoding/json"
	"math"
	"net/http"
	"strings"

	"stream-tribunal/internal/bot"
	"stream-tribunal/internal/config"
	"stream-tribunal/internal/court"
)

func registerSettings(mux *http.ServeMux, currentConfig func() *config.Config, publish func(http.ResponseWriter, *config.Config) bool, engine *court.Engine, gate *bot.Gate) {
	mux.HandleFunc("/api/settings", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case http.MethodGet:
			if !checkHTTPAuth(currentConfig(), r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			json.NewEncoder(w).Encode(settingsView(currentConfig()))
		case http.MethodPut:
			if !checkHTTPAuth(currentConfig(), r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			var req struct {
				WitnessEnabled   *bool              `json:"witness_enabled"`
				BribeMin         *float64           `json:"bribe_min"`
				BribeWords       []string           `json:"bribe_words"`
				QueueMin         *float64           `json:"queue_min"`
				QueueOpen        *bool              `json:"queue_open"`
				RuleCurrency     *string            `json:"rule_currency"`
				CasesGenEnabled  *bool              `json:"cases_gen_enabled"`
				CasesGenBatch    *int               `json:"cases_gen_batch"`
				CasesGenLowMark  *int               `json:"cases_gen_low_mark"`
				MinAmounts       map[string]float64 `json:"min_amounts"`
				DefaultMin       *float64           `json:"default_min"`
				StreamerTrialMin *float64           `json:"streamer_trial_min"`
				PlatinumMin      *float64           `json:"platinum_min"`
				JudgeName        *string            `json:"judge_name"`
				Theme            *string            `json:"theme"`
				Punishments      []string           `json:"punishments"`
				JudgeStyle       *string            `json:"judge_style"`
				DefenseSec       *int               `json:"defense_sec"`
				TestimonySec     *int               `json:"testimony_sec"`
				SueThreshold     *int               `json:"sue_threshold"`
				SueWindowSec     *int               `json:"sue_window_sec"`
				CrimeEnabled     *bool              `json:"crime_enabled"`
				StreamerChance   *float64           `json:"streamer_chance"`
				Articles         []string           `json:"articles"`
			}
			if err := decodeJSON(w, r, &req); err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			next := currentConfig().Clone()
			if req.WitnessEnabled != nil {
				next.Donations.WitnessEnabled = *req.WitnessEnabled
			}
			for _, threshold := range []*float64{req.BribeMin, req.QueueMin, req.DefaultMin, req.StreamerTrialMin, req.PlatinumMin} {
				if threshold != nil && (math.IsNaN(*threshold) || math.IsInf(*threshold, 0) || *threshold < 0) {
					http.Error(w, "thresholds must be finite and nonnegative", http.StatusBadRequest)
					return
				}
			}
			for code, threshold := range req.MinAmounts {
				if code != strings.ToUpper(strings.TrimSpace(code)) || len(code) < 3 || len(code) > 16 || math.IsNaN(threshold) || math.IsInf(threshold, 0) || threshold < 0 {
					http.Error(w, "invalid currency minimum", http.StatusBadRequest)
					return
				}
			}
			if req.RuleCurrency != nil {
				code := strings.ToUpper(strings.TrimSpace(*req.RuleCurrency))
				if code != "RUB" && code != "USD" && code != "EUR" && code != "BITS" {
					http.Error(w, "unsupported rule currency", 400)
					return
				}
				next.Donations.RuleCurrency = code
			}
			if req.BribeMin != nil {
				next.Donations.BribeMin = *req.BribeMin
			}
			if req.QueueMin != nil {
				next.Donations.QueueMin = *req.QueueMin
			}
			if req.QueueOpen != nil {
				next.Courtroom.QueueOpen = *req.QueueOpen
			}
			if req.BribeWords != nil {
				if len(req.BribeWords) > 20 {
					http.Error(w, "too many bribe words", 400)
					return
				}
				next.Safety.BribeWords = nil
				for _, word := range req.BribeWords {
					word = strings.TrimSpace(word)
					if len([]rune(word)) > 64 {
						http.Error(w, "bribe word too long", 400)
						return
					}
					if word != "" {
						next.Safety.BribeWords = append(next.Safety.BribeWords, word)
					}
				}
			}
			if req.CasesGenEnabled != nil {
				next.Courtroom.CasesGen.Enabled = *req.CasesGenEnabled
			}
			if req.CasesGenBatch != nil {
				if *req.CasesGenBatch < 1 || *req.CasesGenBatch > 25 {
					http.Error(w, "batch must be 1..25", 400)
					return
				}
				next.Courtroom.CasesGen.Batch = *req.CasesGenBatch
			}
			if req.CasesGenLowMark != nil {
				if *req.CasesGenLowMark < 0 || *req.CasesGenLowMark > 100 {
					http.Error(w, "low mark must be 0..100", 400)
					return
				}
				next.Courtroom.CasesGen.LowMark = *req.CasesGenLowMark
			}
			if req.MinAmounts != nil {
				next.Donations.MinAmounts = req.MinAmounts
			}
			if req.DefaultMin != nil {
				next.Donations.DefaultMin = *req.DefaultMin
			}
			if req.StreamerTrialMin != nil && *req.StreamerTrialMin >= 0 {
				next.Donations.StreamerTrialMin = *req.StreamerTrialMin
			}
			if req.PlatinumMin != nil && *req.PlatinumMin >= 0 {
				next.Donations.PlatinumMin = *req.PlatinumMin
			}
			if req.JudgeName != nil && strings.TrimSpace(*req.JudgeName) != "" {
				next.Courtroom.JudgeName = strings.TrimSpace(*req.JudgeName)
			}
			if req.Theme != nil && strings.TrimSpace(*req.Theme) != "" {
				next.Courtroom.Theme = strings.TrimSpace(*req.Theme)
			}
			if req.Punishments != nil {
				next.Courtroom.Punishments = req.Punishments
			}
			if req.Articles != nil {
				next.Courtroom.Articles = req.Articles
			}
			if req.JudgeStyle != nil {
				switch *req.JudgeStyle {
				case "cynical":
					next.Courtroom.JudgeStyle = "cynical"
				case "random":
					next.Courtroom.JudgeStyle = "random"
				default:
					next.Courtroom.JudgeStyle = "strict"
				}
			}
			if req.DefenseSec != nil && *req.DefenseSec >= 5 && *req.DefenseSec <= 120 {
				next.Courtroom.DefenseSec = *req.DefenseSec
			}
			if req.TestimonySec != nil && *req.TestimonySec >= 5 && *req.TestimonySec <= 120 {
				next.Courtroom.TestimonySec = *req.TestimonySec
			}
			if req.SueThreshold != nil && *req.SueThreshold >= 0 && *req.SueThreshold <= 100 {
				next.Courtroom.SueThreshold = *req.SueThreshold
			}
			if req.SueWindowSec != nil && *req.SueWindowSec >= 60 && *req.SueWindowSec <= 3600 {
				next.Courtroom.SueWindowSec = *req.SueWindowSec
			}
			if req.CrimeEnabled != nil {
				next.Courtroom.CrimeEnabled = *req.CrimeEnabled
			}
			if req.StreamerChance != nil && *req.StreamerChance >= 0 && *req.StreamerChance <= 1 {
				next.Courtroom.StreamerChance = *req.StreamerChance
			}
			if !publish(w, next) {
				return
			}
			if req.Punishments != nil {
				engine.SetPunishments(req.Punishments)
			}
			gate.SetMinimums(next.Donations.MinAmounts, next.Donations.DefaultMin)
			json.NewEncoder(w).Encode(settingsView(next))
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

}

func settingsView(cfg *config.Config) map[string]any {
	return map[string]any{
		"min_amounts": cfg.Donations.MinAmounts, "default_min": cfg.Donations.DefaultMin,
		"rule_currency": cfg.Donations.RuleCurrency, "witness_enabled": cfg.Donations.WitnessEnabled, "bribe_min": cfg.Donations.BribeMin,
		"bribe_words": cfg.Safety.BribeWords, "queue_min": cfg.Donations.QueueMin, "queue_open": cfg.Courtroom.QueueOpen,
		"streamer_trial_min": cfg.Donations.StreamerTrialMin, "platinum_min": cfg.Donations.PlatinumMin,
		"judge_name": cfg.Courtroom.JudgeName, "theme": cfg.Courtroom.Theme, "punishments": cfg.Courtroom.Punishments,
		"judge_style": cfg.Courtroom.JudgeStyle, "defense_sec": cfg.Courtroom.DefenseSec, "testimony_sec": cfg.Courtroom.TestimonySec,
		"sue_threshold": cfg.Courtroom.SueThreshold, "sue_window_sec": cfg.Courtroom.SueWindowSec, "crime_enabled": cfg.Courtroom.CrimeEnabled,
		"streamer_chance": cfg.Courtroom.StreamerChance, "articles": cfg.Courtroom.Articles,
		"cases_gen_enabled": cfg.Courtroom.CasesGen.Enabled, "cases_gen_batch": cfg.Courtroom.CasesGen.Batch, "cases_gen_low_mark": cfg.Courtroom.CasesGen.LowMark,
	}
}
