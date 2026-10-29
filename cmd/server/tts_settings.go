package main

import (
	"encoding/json"
	"net/http"
	"strings"

	"stream-tribunal/internal/config"
	"stream-tribunal/internal/court"
)

func registerTTS(mux *http.ServeMux, currentConfig func() *config.Config, publish func(http.ResponseWriter, *config.Config) bool, engine *court.Engine, swapVoice func(*config.Config)) {
	mux.HandleFunc("/api/tts", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ttsStatus := func() map[string]any {
			return map[string]any{
				"roles":           currentConfig().TTS.Roles,
				"delivery":        currentConfig().TTS.Delivery,
				"engine":          currentConfig().TTS.Engine,
				"voice":           currentConfig().TTS.Voice,
				"rate":            currentConfig().TTS.Rate,
				"volume":          currentConfig().TTS.Volume,
				"pitch":           currentConfig().TTS.Pitch,
				"judge_voice":     currentConfig().TTS.JudgeVoice,
				"judge_rate":      currentConfig().TTS.JudgeRate,
				"silero_url":      currentConfig().TTS.SileroURL,
				"silero_judge":    currentConfig().TTS.SileroJudge,
				"enabled":         currentConfig().TTS.Enabled,
				"auto_fallback":   currentConfig().TTS.AutoFallback,
				"beep":            ttsIsBeep(currentConfig()),
				"eleven_has_key":  currentConfig().TTS.ElevenAPIKey != "",
				"eleven_voice_id": currentConfig().TTS.ElevenVoiceID,
				"eleven_model_id": currentConfig().TTS.ElevenModelID,
				"piper_binary":    currentConfig().TTS.PiperBinary,
				"model_path":      currentConfig().TTS.ModelPath,
				"config_path":     currentConfig().TTS.ConfigPath,
				"speaker_id":      currentConfig().TTS.SpeakerID,
				"speed":           currentConfig().TTS.Speed,
				"voices": map[string]any{
					"edge":   []string{"ru-RU-SvetlanaNeural", "ru-RU-DmitryNeural"},
					"silero": []string{"xenia", "kseniya", "baya", "aidar", "eugene"},
					"piper":  []string{"ru_irina", "ru_dmitri", "ru_ruslan", "ru_denis"},
				},
			}
		}
		switch r.Method {
		case http.MethodGet:
			if !checkHTTPAuth(currentConfig(), r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			json.NewEncoder(w).Encode(ttsStatus())
		case http.MethodPut:
			if !checkHTTPAuth(currentConfig(), r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			if engine.GetState() != court.StateIdle {
				http.Error(w, "finish the current trial first", http.StatusConflict)
				return
			}
			var req struct {
				Roles         *map[string]config.RoleVoice `json:"roles"`
				Delivery      *string                      `json:"delivery"`
				ElevenAPIKey  *string                      `json:"eleven_api_key"`
				ElevenVoiceID *string                      `json:"eleven_voice_id"`
				ElevenModelID *string                      `json:"eleven_model_id"`
				Engine        *string                      `json:"engine"`
				Voice         *string                      `json:"voice"`
				Rate          *string                      `json:"rate"`
				Volume        *string                      `json:"volume"`
				Pitch         *string                      `json:"pitch"`
				JudgeVoice    *string                      `json:"judge_voice"`
				JudgeRate     *string                      `json:"judge_rate"`
				SileroURL     *string                      `json:"silero_url"`
				SileroJudge   *string                      `json:"silero_judge"`
				Enabled       *bool                        `json:"enabled"`
				AutoFallback  *bool                        `json:"auto_fallback"`
				PiperBinary   *string                      `json:"piper_binary"`
				ModelPath     *string                      `json:"model_path"`
				ConfigPath    *string                      `json:"config_path"`
				SpeakerID     *int                         `json:"speaker_id"`
				Speed         *float64                     `json:"speed"`
			}
			if err := decodeJSON(w, r, &req); err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			next := currentConfig().Clone()
			if req.Roles != nil {
				if len(*req.Roles) > 3 {
					http.Error(w, "Нужно не больше трёх ролей.", 400)
					return
				}
				for role := range *req.Roles {
					if role != "judge" && role != "prosecutor" && role != "advocate" {
						http.Error(w, "Неизвестная роль.", 400)
						return
					}
				}
				next.TTS.Roles = *req.Roles
			}
			if req.Delivery != nil {
				if *req.Delivery != "natural" && *req.Delivery != "restrained" && *req.Delivery != "expressive" {
					http.Error(w, "Неизвестная подача голоса.", 400)
					return
				}
				next.TTS.Delivery = *req.Delivery
			}
			if req.Engine != nil {
				switch *req.Engine {
				case "edge", "silero", "piper", "mock", "elevenlabs":
					next.TTS.Engine = *req.Engine
				default:
					http.Error(w, "want engine edge, silero, piper, elevenlabs or mock", http.StatusBadRequest)
					return
				}
			}
			if req.ElevenAPIKey != nil {
				next.TTS.ElevenAPIKey = strings.TrimSpace(*req.ElevenAPIKey)
			}
			if req.ElevenVoiceID != nil {
				next.TTS.ElevenVoiceID = strings.TrimSpace(*req.ElevenVoiceID)
			}
			if req.ElevenModelID != nil {
				next.TTS.ElevenModelID = strings.TrimSpace(*req.ElevenModelID)
			}
			if req.Voice != nil && *req.Voice != "" {
				next.TTS.Voice = *req.Voice
			}
			if req.Rate != nil && *req.Rate != "" {
				next.TTS.Rate = *req.Rate
			}
			if req.Volume != nil && *req.Volume != "" {
				next.TTS.Volume = *req.Volume
			}
			if req.Pitch != nil && *req.Pitch != "" {
				next.TTS.Pitch = *req.Pitch
			}
			if req.JudgeVoice != nil && *req.JudgeVoice != "" {
				next.TTS.JudgeVoice = *req.JudgeVoice
			}
			if req.JudgeRate != nil && *req.JudgeRate != "" {
				next.TTS.JudgeRate = *req.JudgeRate
			}
			if req.SileroURL != nil && *req.SileroURL != "" {
				next.TTS.SileroURL = *req.SileroURL
			}
			if req.SileroJudge != nil && *req.SileroJudge != "" {
				next.TTS.SileroJudge = *req.SileroJudge
			}
			if req.Enabled != nil {
				next.TTS.Enabled = *req.Enabled
			}
			if req.AutoFallback != nil {
				next.TTS.AutoFallback = *req.AutoFallback
			}
			if req.PiperBinary != nil && *req.PiperBinary != "" {
				next.TTS.PiperBinary = *req.PiperBinary
			}
			if req.ModelPath != nil && *req.ModelPath != "" {
				next.TTS.ModelPath = *req.ModelPath
			}
			if req.ConfigPath != nil && *req.ConfigPath != "" {
				next.TTS.ConfigPath = *req.ConfigPath
			}
			if req.SpeakerID != nil && *req.SpeakerID >= 0 {
				next.TTS.SpeakerID = *req.SpeakerID
			}
			if req.Speed != nil && *req.Speed > 0 && *req.Speed <= 3 {
				next.TTS.Speed = *req.Speed
			}
			if !publish(w, next) {
				return
			}
			swapVoice(next)
			json.NewEncoder(w).Encode(ttsStatus())
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

}
