package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"stream-tribunal/internal/ai"
	"stream-tribunal/internal/audio"
	"stream-tribunal/internal/bot"
	"stream-tribunal/internal/config"
	"stream-tribunal/internal/court"
	"stream-tribunal/internal/memory"
	"stream-tribunal/internal/obs"
	"stream-tribunal/internal/safety"
	"stream-tribunal/web"
)

func main() {
	cfg, err := config.LoadConfig("config.yaml")
	if err != nil {
		log.Printf("failed reading config.yaml (%v), checking config.default.yaml", err)
		cfg, err = config.LoadConfig("config.default.yaml")
		if err != nil {
			log.Fatalf("failed loading configuration: %v", err)
		}
	}

	filter := safety.NewFilter(cfg.Safety.CustomBlacklist)

	voice := buildSynthesizer(cfg)
	defer voice.Close()

	aiClient := ai.NewClient(cfg.AI)
	recall := memory.NewStore(cfg.Game.MemoryPath)

	unbanCourt := bot.NewUnbanClient(cfg.Twitch.Token, cfg.Twitch.ClientID, cfg.Twitch.BroadcasterID, cfg.Twitch.ModeratorID)
	unbanBoard := newUnbanBoard()

	var startWatchers func()

	var engine *court.Engine

	limiter := newActionLimiter(500 * time.Millisecond)
	donateGate := bot.NewGate(cfg.Donations.MinAmounts, cfg.Donations.DefaultMin)

	var hub *obs.Hub
	hub = obs.NewHub(func(action string, payload []byte) {
		if engine == nil {
			return
		}
		switch action {
		case "start_trial":
			var req struct {
				Defendant string `json:"defendant"`
				Crime     string `json:"crime"`
				Context   string `json:"context"`
				Secret    string `json:"secret"`
			}
			if err := json.Unmarshal(payload, &req); err == nil {
				if !checkSecret(cfg, req.Secret) {
					return
				}
				if err := engine.StartTrial(req.Defendant, req.Crime, req.Context); err != nil {
					log.Printf("start trial rejected: %v", err)
				}
			}
		case "panic":
			var req struct {
				Secret string `json:"secret"`
			}
			if err := json.Unmarshal(payload, &req); err != nil {
				return
			}
			if !checkSecret(cfg, req.Secret) {
				return
			}
			engine.TriggerPanic()
		case "chat":
			var chatReq struct {
				Author string `json:"author"`
				Text   string `json:"text"`
			}
			if err := json.Unmarshal(payload, &chatReq); err == nil {
				if chatReq.Author == "" || !limiter.allow("chat:"+chatReq.Author) {
					return
				}
				engine.AddChatComment(chatReq.Author, chatReq.Text)
			}
		case "defense":
			var defReq struct {
				Author string `json:"author"`
				Text   string `json:"text"`
			}
			if err := json.Unmarshal(payload, &defReq); err == nil {
				if defReq.Author == "" {
					defReq.Author = "стример"
				}
				if !limiter.allow("defense:" + defReq.Author) {
					return
				}
				engine.AddDefense(defReq.Author, defReq.Text)
			}
		case "animation":
			var animReq struct {
				Name string `json:"name"`
			}
			if err := json.Unmarshal(payload, &animReq); err == nil && animReq.Name != "" {
				hub.BroadcastEvent(obs.EventAnimation, obs.AnimationPayload{Name: animReq.Name})
			}
		}
	})

	go hub.Run()

	engine = court.NewEngine(cfg, hub, aiClient, voice, filter)
	engine.AttachMemory(recall)
	engine.SetPunishments(cfg.Courtroom.Punishments)

	var chat *bot.TwitchIRC

	// streamer trials are rare events now: manual starts and platinum donations only
	openStreamerTrial := func(defendant, crime, context string) bool {
		if err := engine.StartTrial(defendant, crime, context); err != nil {
			log.Printf("start trial rejected: %v", err)
			return false
		}
		return true
	}

	handleDonation := func(d bot.Donation) {
		recall.AddDonation(memory.DonationRecord{Donor: d.Donor, Amount: d.Amount, Currency: d.Currency, Message: d.Message})
		event := bot.DonationEvent{Donor: d.Donor, Amount: d.Amount, Currency: d.Currency, Message: d.Message}
		passed := donateGate.Pass(event)
		hub.BroadcastEvent(obs.EventDonation, obs.DonationPayload{
			Donor:      d.Donor,
			Amount:     d.Amount,
			Currency:   d.Currency,
			Message:    d.Message,
			OpensTrial: passed,
		})
		if !passed {
			return
		}
		donor := d.Donor
		if donor == "" {
			donor = "Аноним"
		}
		if d.Amount >= 500 && donor != "" {
			recall.NoteForAI("меценат " + donor + " любит взятки и ждет снисхождения")
		}
		// queue donation as testimony during active trial instead of competing
		if engine.AddWitness(donor, d.Amount, d.Currency, d.Message) {
			if isBribe(d.Message) {
				engine.AddBribe(donor, d.Amount, d.Currency)
			}
			return
		}
		if d.Amount >= cfg.Donations.PlatinumMin && cfg.Donations.PlatinumMin > 0 {
			crime := "Донат с требованием суда"
			if strings.TrimSpace(d.Message) != "" {
				crime = "Донат: " + strings.TrimSpace(d.Message)
			}
			context := "Донат " + strconv.FormatFloat(d.Amount, 'f', -1, 64) + " " + d.Currency + " от " + donor
			openStreamerTrial(cfg.Game.StreamerName, crime, context)
		}
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", hub.ServeWS)

	overlaySub, err := fs.Sub(web.StaticFS, "overlay")
	if err != nil {
		log.Fatalf("failed embedding overlay fs: %v", err)
	}
	mux.Handle("/overlay/", http.StripPrefix("/overlay/", http.FileServer(http.FS(overlaySub))))
	mux.HandleFunc("/overlay", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/overlay/", http.StatusMovedPermanently)
	})

	dashboardSub, err := fs.Sub(web.StaticFS, "dashboard")
	if err != nil {
		log.Fatalf("failed embedding dashboard fs: %v", err)
	}
	dashboardHandler := spaHandler(dashboardSub)
	mux.Handle("/admin/", http.StripPrefix("/admin/", dashboardHandler))
	mux.HandleFunc("/settings", dashboardHandler.ServeHTTP)
	mux.HandleFunc("/modes", dashboardHandler.ServeHTTP)
	mux.Handle("/", dashboardHandler)

	mux.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		status := map[string]interface{}{
			"status": "online",
			"state":  engine.GetState(),
			"port":   cfg.Server.Port,
		}
		if chat != nil {
			if modErr, bad := chat.LastModError(); bad {
				status["chat_mod_error"] = modErr
			}
		}
		json.NewEncoder(w).Encode(status)
	})

	mux.HandleFunc("/api/trial", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !checkHTTPAuth(cfg, r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req struct {
			Defendant string `json:"defendant"`
			Crime     string `json:"crime"`
			Context   string `json:"context"`
			Viewer    bool   `json:"viewer"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		if req.Defendant == "" {
			req.Defendant = cfg.Game.StreamerName
		}
		var trialErr error
		if req.Viewer {
			trialErr = engine.StartViewerTrial(req.Defendant, req.Crime)
		} else {
			trialErr = engine.StartTrial(req.Defendant, req.Crime, req.Context)
		}
		if trialErr != nil {
			http.Error(w, trialErr.Error(), http.StatusConflict)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	})

	mux.HandleFunc("/api/say", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !checkHTTPAuth(cfg, r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req struct {
			Text string `json:"text"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Text == "" {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		engine.Say(req.Text)
		w.WriteHeader(http.StatusAccepted)
	})

	mux.HandleFunc("/api/profile", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case http.MethodGet:
			json.NewEncoder(w).Encode(recall.GetProfile())
		case http.MethodPut:
			if !checkHTTPAuth(cfg, r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			var p memory.StreamerProfile
			if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			recall.SetProfile(p)
			json.NewEncoder(w).Encode(recall.GetProfile())
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/ai", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		aiStatus := func() map[string]any {
			return map[string]any{
				"provider":    cfg.AI.Provider,
				"model":       cfg.AI.Model,
				"temperature": cfg.AI.Temperature,
				"stream":      cfg.AI.Stream,
				"base_url":    cfg.AI.BaseURL,
				"has_key":     cfg.AI.APIKey != "",
				"live":        cfg.AI.APIKey != "" || cfg.AI.Provider == "ollama",
			}
		}
		switch r.Method {
		case http.MethodGet:
			json.NewEncoder(w).Encode(aiStatus())
		case http.MethodPut:
			if !checkHTTPAuth(cfg, r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			var req struct {
				Provider    *string  `json:"provider"`
				APIKey      *string  `json:"api_key"`
				Model       *string  `json:"model"`
				Temperature *float64 `json:"temperature"`
				BaseURL     *string  `json:"base_url"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			if req.Provider != nil {
				switch *req.Provider {
				case "groq", "cerebras", "ollama":
					cfg.AI.Provider = *req.Provider
				default:
					http.Error(w, "want provider groq, cerebras or ollama", http.StatusBadRequest)
					return
				}
			}
			if req.APIKey != nil {
				cfg.AI.APIKey = *req.APIKey
			}
			if req.Model != nil && *req.Model != "" {
				cfg.AI.Model = *req.Model
			}
			if req.Temperature != nil {
				cfg.AI.Temperature = *req.Temperature
			}
			if req.BaseURL != nil {
				cfg.AI.BaseURL = *req.BaseURL
			}
			if err := cfg.Save("config.yaml"); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			engine.SetAI(ai.NewClient(cfg.AI))
			json.NewEncoder(w).Encode(aiStatus())
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/tts", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ttsStatus := func() map[string]any {
			return map[string]any{
				"engine":       cfg.TTS.Engine,
				"voice":        cfg.TTS.Voice,
				"rate":         cfg.TTS.Rate,
				"volume":       cfg.TTS.Volume,
				"pitch":        cfg.TTS.Pitch,
				"judge_voice":  cfg.TTS.JudgeVoice,
				"judge_rate":   cfg.TTS.JudgeRate,
				"silero_url":   cfg.TTS.SileroURL,
				"silero_judge": cfg.TTS.SileroJudge,
			}
		}
		switch r.Method {
		case http.MethodGet:
			json.NewEncoder(w).Encode(ttsStatus())
		case http.MethodPut:
			if !checkHTTPAuth(cfg, r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			var req struct {
				Engine      *string `json:"engine"`
				Voice       *string `json:"voice"`
				Rate        *string `json:"rate"`
				Volume      *string `json:"volume"`
				Pitch       *string `json:"pitch"`
				JudgeVoice  *string `json:"judge_voice"`
				JudgeRate   *string `json:"judge_rate"`
				SileroURL   *string `json:"silero_url"`
				SileroJudge *string `json:"silero_judge"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			if req.Engine != nil {
				switch *req.Engine {
				case "edge", "silero", "piper", "mock":
					cfg.TTS.Engine = *req.Engine
				default:
					http.Error(w, "want engine edge, silero, piper or mock", http.StatusBadRequest)
					return
				}
			}
			if req.Voice != nil && *req.Voice != "" {
				cfg.TTS.Voice = *req.Voice
			}
			if req.Rate != nil && *req.Rate != "" {
				cfg.TTS.Rate = *req.Rate
			}
			if req.Volume != nil && *req.Volume != "" {
				cfg.TTS.Volume = *req.Volume
			}
			if req.Pitch != nil && *req.Pitch != "" {
				cfg.TTS.Pitch = *req.Pitch
			}
			if req.JudgeVoice != nil && *req.JudgeVoice != "" {
				cfg.TTS.JudgeVoice = *req.JudgeVoice
			}
			if req.JudgeRate != nil && *req.JudgeRate != "" {
				cfg.TTS.JudgeRate = *req.JudgeRate
			}
			if req.SileroURL != nil && *req.SileroURL != "" {
				cfg.TTS.SileroURL = *req.SileroURL
			}
			if req.SileroJudge != nil && *req.SileroJudge != "" {
				cfg.TTS.SileroJudge = *req.SileroJudge
			}
			if err := cfg.Save("config.yaml"); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			old := voice
			voice = buildSynthesizer(cfg)
			engine.SetVoice(voice)
			_ = old.Close()
			json.NewEncoder(w).Encode(ttsStatus())
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/history", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"trials": recall.RecentTrials(10),
			"top":    recall.TopAccusers(5),
		})
	})

	mux.HandleFunc("/api/unban", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"requests": unbanBoard.list()})
	})

	mux.HandleFunc("/api/unban/resolve", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !checkHTTPAuth(cfg, r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req struct {
			ID      string `json:"id"`
			Approve bool   `json:"approve"`
			Text    string `json:"text"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID == "" {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		if err := unbanCourt.Resolve(ctx, req.ID, req.Approve, req.Text); err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		unbanBoard.refresh(context.Background(), unbanCourt)
		w.WriteHeader(http.StatusAccepted)
	})

	mux.HandleFunc("/api/dock", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{
			"pool":       engine.PoolList(),
			"defendant":  engine.CurrentDefendant(),
			"punishment": engine.GetPunishment(),
		})
	})

	mux.HandleFunc("/api/dock/pick", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !checkHTTPAuth(cfg, r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req struct {
			Nick string `json:"nick"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		var seat court.PoolSeat
		var ok bool
		if req.Nick != "" {
			seat, ok = engine.PickNick(req.Nick)
		} else {
			seat, ok = engine.PickRandom()
		}
		if !ok {
			http.Error(w, "pool is empty", http.StatusConflict)
			return
		}
		crime := seat.Reason
		if crime == "" {
			crime = "выбран залом"
		}
		if err := engine.StartViewerTrial(seat.Nick, crime); err != nil {
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"defendant": seat.Nick})
	})

	mux.HandleFunc("/api/dock/skip", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !checkHTTPAuth(cfg, r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		engine.AbortTrial()
		if seat, ok := engine.PickRandom(); ok {
			crime := seat.Reason
			if crime == "" {
				crime = "выбран залом"
			}
			if err := engine.StartViewerTrial(seat.Nick, crime); err == nil {
				json.NewEncoder(w).Encode(map[string]any{"defendant": seat.Nick})
				return
			}
		}
		json.NewEncoder(w).Encode(map[string]any{"defendant": ""})
	})

	mux.HandleFunc("/api/punish", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !checkHTTPAuth(cfg, r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req struct {
			Kind string `json:"kind"`
			Secs int    `json:"secs"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"punishment": engine.SetPunishment(req.Kind, req.Secs)})
	})

	mux.HandleFunc("/api/integrations", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		integrationsStatus := func() map[string]any {
			return map[string]any{
				"donationalerts": cfg.Donations.DonationAlerts.Token != "",
				"donatepay":      cfg.Donations.DonatePay.APIKey != "",
				"twitch":         cfg.Twitch.Token != "",
				"channel":        cfg.Twitch.Channel,
				"nick":           cfg.Twitch.Nick,
				"client_id":      cfg.Twitch.ClientID,
				"broadcaster_id": cfg.Twitch.BroadcasterID,
			}
		}
		switch r.Method {
		case http.MethodGet:
			json.NewEncoder(w).Encode(integrationsStatus())
		case http.MethodPut:
			if !checkHTTPAuth(cfg, r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			var req struct {
				DonationAlerts *string `json:"donationalerts_token"`
				DonatePay      *string `json:"donatepay_key"`
				TwitchToken    *string `json:"twitch_token"`
				Channel        *string `json:"channel"`
				Nick           *string `json:"nick"`
				ClientID       *string `json:"client_id"`
				BroadcasterID  *string `json:"broadcaster_id"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			if req.DonationAlerts != nil {
				cfg.Donations.Token = *req.DonationAlerts
				cfg.Donations.DonationAlerts.Token = *req.DonationAlerts
			}
			if req.DonatePay != nil {
				cfg.Donations.DonatePay.APIKey = *req.DonatePay
			}
			if req.TwitchToken != nil {
				cfg.Twitch.Token = *req.TwitchToken
			}
			if req.Channel != nil && *req.Channel != "" {
				cfg.Twitch.Channel = *req.Channel
			}
			if req.Nick != nil && *req.Nick != "" {
				cfg.Twitch.Nick = *req.Nick
			}
			if req.ClientID != nil {
				cfg.Twitch.ClientID = *req.ClientID
			}
			if req.BroadcasterID != nil {
				cfg.Twitch.BroadcasterID = *req.BroadcasterID
				if cfg.Twitch.ModeratorID == "" {
					cfg.Twitch.ModeratorID = *req.BroadcasterID
				}
			}
			if err := cfg.Save("config.yaml"); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			donateGate.SetMinimums(cfg.Donations.MinAmounts, cfg.Donations.DefaultMin)
			unbanCourt = bot.NewUnbanClient(cfg.Twitch.Token, cfg.Twitch.ClientID, cfg.Twitch.BroadcasterID, cfg.Twitch.ModeratorID)
			startWatchers()
			json.NewEncoder(w).Encode(integrationsStatus())
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/judge/photo", func(w http.ResponseWriter, r *http.Request) {
		state := r.URL.Query().Get("state")
		if !validJudgeState(state) {
			http.Error(w, "unknown state, want normal|angry|gavel", http.StatusBadRequest)
			return
		}
		switch r.Method {
		case http.MethodGet:
			serveJudgePhoto(w, r, state)
		case http.MethodPost:
			if !checkHTTPAuth(cfg, r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			if err := saveJudgePhoto(r, state); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/sfx", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		files := []map[string]any{}
		if entries, err := fs.ReadDir(web.StaticFS, "overlay/sfx"); err == nil {
			for _, entry := range entries {
				if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".mp3") {
					continue
				}
				size := int64(0)
				if info, err := entry.Info(); err == nil {
					size = info.Size()
				}
				files = append(files, map[string]any{"name": entry.Name(), "size": size})
			}
		}
		judge := map[string]bool{}
		for _, state := range []string{"normal", "angry", "gavel"} {
			if fi, err := os.Stat(judgePhotoPath(state)); err == nil && !fi.IsDir() {
				judge[state] = true
			}
		}
		json.NewEncoder(w).Encode(map[string]any{"sfx": files, "judge": judge})
	})

	mux.HandleFunc("/api/donate", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !checkHTTPAuth(cfg, r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req struct {
			Donor    string  `json:"donor"`
			Amount   float64 `json:"amount"`
			Currency string  `json:"currency"`
			Message  string  `json:"message"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Amount <= 0 {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		handleDonation(bot.Donation{Donor: req.Donor, Amount: req.Amount, Currency: req.Currency, Message: req.Message})
		w.WriteHeader(http.StatusAccepted)
	})

	gameCtx, stopGame := context.WithCancel(context.Background())
	defer stopGame()

	mux.HandleFunc("/api/settings", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case http.MethodGet:
			json.NewEncoder(w).Encode(map[string]any{
				"min_amounts":   cfg.Donations.MinAmounts,
				"default_min":   cfg.Donations.DefaultMin,
				"punishments":   cfg.Courtroom.Punishments,
				"judge_style":   cfg.Courtroom.JudgeStyle,
				"defense_sec":   cfg.Courtroom.DefenseSec,
				"testimony_sec": cfg.Courtroom.TestimonySec,
			})
		case http.MethodPut:
			if !checkHTTPAuth(cfg, r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			var req struct {
				MinAmounts   map[string]float64 `json:"min_amounts"`
				DefaultMin   *float64           `json:"default_min"`
				Punishments  []string           `json:"punishments"`
				JudgeStyle   *string            `json:"judge_style"`
				DefenseSec   *int               `json:"defense_sec"`
				TestimonySec *int               `json:"testimony_sec"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			if req.MinAmounts != nil {
				cfg.Donations.MinAmounts = req.MinAmounts
			}
			if req.DefaultMin != nil {
				cfg.Donations.DefaultMin = *req.DefaultMin
			}
			if req.Punishments != nil {
				cfg.Courtroom.Punishments = req.Punishments
				engine.SetPunishments(req.Punishments)
			}
			if req.JudgeStyle != nil {
				if *req.JudgeStyle == "cynical" {
					cfg.Courtroom.JudgeStyle = "cynical"
				} else {
					cfg.Courtroom.JudgeStyle = "strict"
				}
			}
			if req.DefenseSec != nil && *req.DefenseSec >= 5 && *req.DefenseSec <= 120 {
				cfg.Courtroom.DefenseSec = *req.DefenseSec
			}
			if req.TestimonySec != nil && *req.TestimonySec >= 5 && *req.TestimonySec <= 120 {
				cfg.Courtroom.TestimonySec = *req.TestimonySec
			}
			if err := cfg.Save("config.yaml"); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			donateGate.SetMinimums(cfg.Donations.MinAmounts, cfg.Donations.DefaultMin)
			json.NewEncoder(w).Encode(map[string]any{
				"min_amounts":   cfg.Donations.MinAmounts,
				"default_min":   cfg.Donations.DefaultMin,
				"punishments":   cfg.Courtroom.Punishments,
				"judge_style":   cfg.Courtroom.JudgeStyle,
				"defense_sec":   cfg.Courtroom.DefenseSec,
				"testimony_sec": cfg.Courtroom.TestimonySec,
			})
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	// chatHandler routes every chat line; chat itself is rebuilt on token change
	chatHandler := func(cmd bot.ChatCommand) {
		switch cmd.Kind {
		case bot.CommandCourt:
			if joined, pos := engine.JoinPool(cmd.Author, cmd.Argument); joined {
				chat.SendMessage(cmd.Author + " в очереди на скамью, номер " + strconv.Itoa(pos))
			}
		case bot.CommandLeave:
			if engine.LeavePool(cmd.Author) {
				chat.SendMessage(cmd.Author + " вышел из очереди")
			}
		case bot.CommandCrime:
			if cmd.Argument != "" {
				engine.AddChatComment(cmd.Author, "!crime "+cmd.Argument)
				if err := engine.StartViewerTrial(cmd.Author, cmd.Argument); err == nil {
					chat.SendMessage("Зритель " + cmd.Author + " сам сел на скамью. Доносы принимаются: !snitch <текст>")
				}
			}
		case bot.CommandSnitch:
			if cmd.Argument != "" {
				engine.AddChatComment(cmd.Author, "!snitch "+cmd.Argument)
			}
		default:
			if !engine.AddTestimony(cmd.Author, cmd.Argument) {
				engine.AddChatComment(cmd.Author, cmd.Argument)
			}
		}
	}

	// watchers restart as one unit when integration tokens change in the desk
	var stopWatchers = func() {}
	startWatchers = func() {
		stopWatchers()
		wctx, cancel := context.WithCancel(gameCtx)
		stopWatchers = cancel
		if cfg.Donations.DonationAlerts.Enabled && cfg.Donations.DonationAlerts.Token != "" {
			daWatcher := bot.NewDonationsWatcher(cfg.Donations.DonationAlerts.Token, handleDonation)
			go daWatcher.Run(wctx)
			log.Println("donationalerts watcher started")
		}
		if cfg.Donations.DonatePay.Enabled && cfg.Donations.DonatePay.APIKey != "" {
			dpWatcher := bot.NewDonatePayWatcher(cfg.Donations.DonatePay.APIKey, handleDonation)
			go dpWatcher.Run(wctx)
			log.Println("donatepay watcher started")
		}
		if cfg.Donations.TwitchBits.Enabled {
			bitsWatcher := bot.NewEventSubWatcher(cfg.Twitch.Token, cfg.Twitch.ClientID, cfg.Twitch.BroadcasterID, func(event bot.DonationEvent) {
				handleDonation(bot.Donation{
					Donor:    event.Donor,
					Amount:   event.Amount,
					Currency: event.Currency,
					Message:  event.Message,
				})
			})
			go bitsWatcher.Run(wctx)
			log.Println("twitch bits watcher started")
		}
		if cfg.Twitch.Token != "" && cfg.Twitch.ClientID != "" && cfg.Twitch.BroadcasterID != "" {
			go unbanBoard.watch(wctx, unbanCourt)
			log.Println("unban court watcher started")
		}
		chat = bot.NewTwitchIRC(cfg.Twitch.Channel, cfg.Twitch.Nick, cfg.Twitch.Token, chatHandler)
		go chat.Run(wctx)
		if cfg.Twitch.Token != "" && cfg.Twitch.Channel != "" {
			log.Printf("twitch chat on #%s as %s", cfg.Twitch.Channel, cfg.Twitch.Nick)
		}
	}
	startWatchers()

	engine.VerdictHook = func(verdict, penalty string, guilty, innocent int, twist string) {
		text := "Вердикт суда: " + verdict + " (" + strconv.Itoa(guilty) + "-" + strconv.Itoa(innocent) + ")"
		if penalty != "" {
			text += ". Наказание: " + penalty
		}
		if twist != "" {
			text += " " + twist
		}
		chat.SendMessage(text)
	}

	engine.TimeoutHook = func(user string, secs int, ban bool, reason string) {
		if ban {
			chat.Ban(user)
			return
		}
		chat.Timeout(user, secs)
	}

	engine.SetPunishments(cfg.Courtroom.Punishments)

	mux.HandleFunc("/favicon.ico", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)
	server := &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}

	go func() {
		log.Printf("Stream Tribunal server running at http://%s", addr)
		log.Printf("OBS overlays: http://%s/overlay/ and http://%s/overlay/judge.html", addr, addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("http server error: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	log.Println("shutting down server...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Printf("server forced to shutdown: %v", err)
	}
	log.Println("server stopped cleanly")
}

func buildSynthesizer(cfg *config.Config) audio.Synthesizer {
	fallback, _ := audio.NewPiperDaemon(cfg.TTS)

	if !cfg.TTS.Enabled {
		return fallback
	}

	switch cfg.TTS.Engine {
	case "piper":
		return fallback
	case "mock":
		return fallback
	case "silero":
		primary := audio.NewSileroSynthesizer(cfg.TTS.SileroURL, cfg.TTS.SileroJudge)
		if cfg.TTS.AutoFallback {
			return audio.NewAutoSynthesizer(primary, fallback)
		}
		return primary
	default:
		primary := audio.NewEdgeSynthesizer(cfg.TTS.Voice, cfg.TTS.Rate, cfg.TTS.Volume, cfg.TTS.Pitch)
		if cfg.TTS.AutoFallback {
			return audio.NewAutoSynthesizer(primary, fallback)
		}
		return primary
	}
}

func checkSecret(cfg *config.Config, got string) bool {
	if cfg.Server.Secret == "" {
		return true
	}
	return got != "" && got == cfg.Server.Secret
}

// isBribe spots donor money marked as a judge payoff
func isBribe(message string) bool {
	return strings.Contains(strings.ToLower(message), "взятк")
}

var judgePhotoExts = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".webp": true,
}

func validJudgeState(state string) bool {
	return state == "normal" || state == "angry" || state == "gavel"
}

func judgePhotoPath(state string) string {
	return filepath.Join("data", "judge", state+".jpg")
}

// fallback to embedded default (angry/gavel fall back to normal until uploaded)
func serveJudgePhoto(w http.ResponseWriter, r *http.Request, state string) {
	if raw, err := os.ReadFile(judgePhotoPath(state)); err == nil {
		w.Header().Set("Content-Type", http.DetectContentType(raw))
		w.Write(raw)
		return
	}
	name := state
	if state != "normal" {
		name = "normal"
	}
	raw, err := web.StaticFS.ReadFile("overlay/assets/judge-" + name + ".jpg")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Write(raw)
}

// saveJudgePhoto stores an uploaded judge portrait, max 5 MB, images only.
func saveJudgePhoto(r *http.Request, state string) error {
	file, header, err := r.FormFile("photo")
	if err != nil {
		return fmt.Errorf("need multipart photo: %w", err)
	}
	defer file.Close()
	ext := strings.ToLower(filepath.Ext(header.Filename))
	if !judgePhotoExts[ext] {
		return fmt.Errorf("want jpg, png or webp")
	}
	raw, err := io.ReadAll(io.LimitReader(file, 5*1024*1024+1))
	if err != nil {
		return err
	}
	if len(raw) > 5*1024*1024 {
		return fmt.Errorf("photo over 5 MB")
	}
	if kind := http.DetectContentType(raw); !strings.HasPrefix(kind, "image/") {
		return fmt.Errorf("not an image")
	}
	if err := os.MkdirAll(filepath.Join("data", "judge"), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Join("data", "judge"), "upload-*.jpg")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(raw); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), judgePhotoPath(state))
}

func checkHTTPAuth(cfg *config.Config, r *http.Request) bool {
	if cfg.Server.Secret == "" {
		return true
	}
	if r.Header.Get("X-Tribunal-Secret") == cfg.Server.Secret {
		return true
	}
	return r.URL.Query().Get("secret") != "" && r.URL.Query().Get("secret") == cfg.Server.Secret
}

// spaHandler serves the Vite SPA bundle with fallback to index.html so
// client-side routes (/, /modes, /settings) survive full reloads without
// breaking the WebSocket session on every tab switch.
func spaHandler(root fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(root))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api") || strings.HasPrefix(r.URL.Path, "/ws") {
			http.NotFound(w, r)
			return
		}
		if r.URL.Path != "/" {
			if f, err := root.Open(strings.TrimPrefix(r.URL.Path, "/")); err == nil {
				_ = f.Close()
				fileServer.ServeHTTP(w, r)
				return
			}
		}
		index, err := fs.ReadFile(root, "index.html")
		if err != nil {
			fileServer.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(index)
	})
}

// unbanBoard caches pending pardon appeals between Helix polls
type unbanBoard struct {
	mu    sync.Mutex
	items []bot.UnbanRequest
}

func newUnbanBoard() *unbanBoard {
	return &unbanBoard{}
}

func (b *unbanBoard) list() []bot.UnbanRequest {
	b.mu.Lock()
	defer b.mu.Unlock()
	out := make([]bot.UnbanRequest, len(b.items))
	copy(out, b.items)
	return out
}

func (b *unbanBoard) refresh(ctx context.Context, court *bot.UnbanClient) {
	items, err := court.FetchPending(ctx)
	if err != nil {
		log.Printf("unban court refresh: %v", err)
		return
	}
	b.mu.Lock()
	b.items = items
	b.mu.Unlock()
}

func (b *unbanBoard) watch(ctx context.Context, court *bot.UnbanClient) {
	b.refresh(ctx, court)
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			b.refresh(ctx, court)
		}
	}
}

type actionLimiter struct {
	mu       sync.Mutex
	interval time.Duration
	last     map[string]time.Time
}

func newActionLimiter(interval time.Duration) *actionLimiter {
	return &actionLimiter{interval: interval, last: make(map[string]time.Time)}
}

func (l *actionLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	if t, ok := l.last[key]; ok && now.Sub(t) < l.interval {
		return false
	}
	l.last[key] = now
	if len(l.last) > 4096 {
		l.last = make(map[string]time.Time, 4096)
	}
	return true
}
