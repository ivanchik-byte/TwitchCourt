package main

import (
	"bytes"
	"context"
	"net/http"
	"regexp"
	"time"

	"stream-tribunal/internal/audio"
	"stream-tribunal/internal/config"
	"stream-tribunal/internal/court"
)

func voicePreview(currentConfig func() *config.Config, engine *court.Engine) http.HandlerFunc {
	slot := make(chan struct{}, 1)
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !checkHTTPAuth(currentConfig(), r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if engine.GetState() != court.StateIdle {
			http.Error(w, "Закончите заседание перед проверкой голоса.", http.StatusConflict)
			return
		}
		var req struct {
			Role          string                       `json:"role"`
			Delivery      *string                      `json:"delivery"`
			Roles         *map[string]config.RoleVoice `json:"roles"`
			Engine        string                       `json:"engine"`
			Voice         string                       `json:"voice"`
			SileroURL     *string                      `json:"silero_url"`
			PiperBinary   *string                      `json:"piper_binary"`
			ModelPath     *string                      `json:"model_path"`
			ConfigPath    *string                      `json:"config_path"`
			SpeakerID     *int                         `json:"speaker_id"`
			Speed         *float64                     `json:"speed"`
			Rate          *string                      `json:"rate"`
			Volume        *string                      `json:"volume"`
			Pitch         *string                      `json:"pitch"`
			ElevenAPIKey  *string                      `json:"eleven_api_key"`
			ElevenVoiceID *string                      `json:"eleven_voice_id"`
			ElevenModelID *string                      `json:"eleven_model_id"`
		}
		if err := decodeJSON(w, r, &req); err != nil || len(req.Voice) > 100 {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		preview := currentConfig().Clone()
		preview.TTS.Enabled, preview.TTS.AutoFallback = true, false
		role := req.Role
		if role == "" {
			role = "judge"
		}
		if role != "judge" && role != "prosecutor" && role != "advocate" {
			http.Error(w, "Неизвестная роль.", 400)
			return
		}
		if req.Roles != nil {
			preview.TTS.Roles = *req.Roles
		}
		if req.Delivery != nil {
			preview.TTS.Delivery = *req.Delivery
		}
		if req.SileroURL != nil {
			preview.TTS.SileroURL = *req.SileroURL
		}
		if req.PiperBinary != nil {
			preview.TTS.PiperBinary = *req.PiperBinary
		}
		if req.ModelPath != nil {
			preview.TTS.ModelPath = *req.ModelPath
		}
		if req.ConfigPath != nil {
			preview.TTS.ConfigPath = *req.ConfigPath
		}
		if req.SpeakerID != nil {
			preview.TTS.SpeakerID = *req.SpeakerID
		}
		if req.Speed != nil {
			preview.TTS.Speed = *req.Speed
		}
		if req.Rate != nil {
			preview.TTS.Rate = *req.Rate
		}
		if req.Volume != nil {
			preview.TTS.Volume = *req.Volume
		}
		if req.Pitch != nil {
			preview.TTS.Pitch = *req.Pitch
		}
		if req.ElevenAPIKey != nil {
			preview.TTS.ElevenAPIKey = *req.ElevenAPIKey
		}
		if req.ElevenVoiceID != nil {
			preview.TTS.ElevenVoiceID = *req.ElevenVoiceID
		}
		if req.ElevenModelID != nil {
			preview.TTS.ElevenModelID = *req.ElevenModelID
		}
		switch req.Engine {
		case "mock":
			preview.TTS.Engine = "mock"
		case "elevenlabs":
			preview.TTS.Engine = req.Engine
			if preview.TTS.ElevenAPIKey == "" || preview.TTS.ElevenVoiceID == "" {
				http.Error(w, "Укажите API-ключ ElevenLabs и Voice ID.", http.StatusPreconditionFailed)
				return
			}
		case "edge":
			preview.TTS.Engine, preview.TTS.Voice = req.Engine, req.Voice
			preview.TTS.JudgeVoice = req.Voice
			if req.Rate != nil {
				preview.TTS.JudgeRate = *req.Rate
			}
		case "silero":
			if !regexp.MustCompile(`^[a-z0-9_]{1,60}$`).MatchString(req.Voice) {
				http.Error(w, "Укажите диктора Silero из списка.", 400)
				return
			}
			preview.TTS.Engine, preview.TTS.SileroJudge = req.Engine, req.Voice
		case "piper":
			preview.TTS.Engine = req.Engine
		default:
			http.Error(w, "choose a speech engine", http.StatusPreconditionFailed)
			return
		}
		select {
		case slot <- struct{}{}:
			defer func() { <-slot }()
		default:
			http.Error(w, "Другая проверка голоса ещё выполняется. Дождитесь её окончания.", http.StatusTooManyRequests)
			return
		}
		voice := buildSingleSynthesizer(roleConfig(preview, role))
		defer voice.Close()
		if piper, ok := voice.(*audio.PiperDaemon); ok && piper.IsMock() && req.Engine != "mock" {
			http.Error(w, "Piper could not start", http.StatusPreconditionFailed)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		audio, err := voice.Synthesize(ctx, "Ваша честь, у защиты есть объяснение. Подсудимый не опоздал, он появился в следующем заседании. Суд готов слушать.")
		if err != nil || len(audio) < 100 {
			message := "Не удалось получить звук. Проверьте настройки выбранного движка."
			if req.Engine == "silero" {
				message = "Silero не ответил. Запустите локальный голос и дождитесь состояния «Готов»."
			}
			if req.Engine == "piper" {
				message = "Piper не запустился. Проверьте исполняемый файл и пару файлов .onnx / .onnx.json."
			}
			if req.Engine == "elevenlabs" && err != nil {
				message = err.Error()
			}
			http.Error(w, message, http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		if bytes.HasPrefix(audio, []byte("RIFF")) {
			w.Header().Set("Content-Type", "audio/wav")
		}
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(audio)
	}
}
