package main

import (
	"bytes"
	"context"
	"net/http"
	"os"
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
			http.Error(w, "finish the current trial first", http.StatusConflict)
			return
		}
		var req struct {
			Engine string `json:"engine"`
			Voice  string `json:"voice"`
		}
		if err := decodeJSON(w, r, &req); err != nil || len(req.Voice) > 100 {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		preview := currentConfig().Clone()
		preview.TTS.Enabled, preview.TTS.AutoFallback = true, false
		switch req.Engine {
		case "edge":
			preview.TTS.Engine, preview.TTS.Voice = req.Engine, req.Voice
		case "silero":
			switch req.Voice {
			case "aidar", "eugene", "kseniya", "xenia", "baya":
			default:
				http.Error(w, "unknown Silero speaker", http.StatusBadRequest)
				return
			}
			preview.TTS.Engine, preview.TTS.SileroJudge = req.Engine, req.Voice
		case "piper":
			preview.TTS.Engine = req.Engine
			_, modelErr := os.Stat(preview.TTS.ModelPath)
			if ttsIsBeep(preview) || modelErr != nil {
				http.Error(w, "Piper binary is missing", http.StatusPreconditionFailed)
				return
			}
		default:
			http.Error(w, "choose a speech engine", http.StatusPreconditionFailed)
			return
		}
		select {
		case slot <- struct{}{}:
			defer func() { <-slot }()
		default:
			http.Error(w, "a voice preview is already running", http.StatusTooManyRequests)
			return
		}
		voice := buildSynthesizer(preview)
		defer voice.Close()
		if piper, ok := voice.(*audio.PiperDaemon); ok && piper.IsMock() {
			http.Error(w, "Piper could not start", http.StatusPreconditionFailed)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		audio, err := voice.Synthesize(ctx, "Ваша честь, у защиты есть объяснение. Подсудимый не опоздал, он появился в следующем заседании. Суд готов слушать.")
		if err != nil || len(audio) < 100 {
			http.Error(w, "speech engine is unavailable", http.StatusBadGateway)
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
