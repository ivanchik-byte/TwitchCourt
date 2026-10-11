package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"math/rand"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"stream-tribunal/internal/ai"
	"stream-tribunal/internal/bot"
	"stream-tribunal/internal/config"
	"stream-tribunal/internal/court"
	"stream-tribunal/internal/memory"
	"stream-tribunal/internal/obs"
	"stream-tribunal/internal/safety"
	"stream-tribunal/internal/tmpl"
	"stream-tribunal/web"
)

func main() {
	initialCfg, err := config.LoadConfig("config.yaml")
	if err != nil {
		log.Printf("failed reading config.yaml (%v), checking config.default.yaml", err)
		initialCfg, err = config.LoadConfig("config.default.yaml")
		if err != nil {
			log.Fatalf("failed loading configuration: %v", err)
		}
	}
	// atomic config pointer: handlers clone and swap, readers load lock-free
	var cfg atomic.Pointer[config.Config]
	cfg.Store(initialCfg)

	filter := safety.NewFilter(cfg.Load().Safety.CustomBlacklist)
	filter.SetEnabled(cfg.Load().Safety.FilterEnabled)

	voice := buildSynthesizer(cfg.Load())
	defer voice.Close()

	aiClient, err := ai.NewClient(cfg.Load().AI)
	if err != nil {
		log.Fatalf("bad ai config: %v", err)
	}
	recall := memory.NewStore(cfg.Load().Game.MemoryPath)

	var unbanCourt atomic.Pointer[bot.UnbanClient]
	unbanCourt.Store(bot.NewUnbanClient(cfg.Load().Twitch.Token, cfg.Load().Twitch.ClientID, cfg.Load().Twitch.BroadcasterID, cfg.Load().Twitch.ModeratorID))
	unbanBoard := newUnbanBoard()

	var startWatchers func()

	var engine *court.Engine

	var srv *http.Server

	limiter := newActionLimiter(500 * time.Millisecond)
	donateGate := bot.NewGate(cfg.Load().Donations.MinAmounts, cfg.Load().Donations.DefaultMin)

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
				if !checkSecret(cfg.Load(), req.Secret) {
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
			if !checkSecret(cfg.Load(), req.Secret) {
				return
			}
			engine.TriggerPanic()
		case "chat":
			var chatReq struct {
				Author string `json:"author"`
				Text   string `json:"text"`
				Secret string `json:"secret"`
			}
			if err := json.Unmarshal(payload, &chatReq); err == nil {
				if !checkSecret(cfg.Load(), chatReq.Secret) {
					return
				}
				if chatReq.Author == "" || !limiter.allow("chat:"+chatReq.Author) {
					return
				}
				engine.AddChatComment(chatReq.Author, chatReq.Text)
			}
		case "defense":
			var defReq struct {
				Author string `json:"author"`
				Text   string `json:"text"`
				Secret string `json:"secret"`
			}
			if err := json.Unmarshal(payload, &defReq); err == nil {
				if !checkSecret(cfg.Load(), defReq.Secret) {
					return
				}
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
				Name   string `json:"name"`
				Secret string `json:"secret"`
			}
			if err := json.Unmarshal(payload, &animReq); err == nil && animReq.Name != "" {
				if !checkSecret(cfg.Load(), animReq.Secret) {
					return
				}
				hub.BroadcastEvent(obs.EventAnimation, obs.AnimationPayload{Name: animReq.Name})
			}
		case "ping":
			hub.BroadcastEvent(obs.EventType("pong"), map[string]string{"status": "ok"})
		}
	})

	go hub.Run()

	hub.Secret = func() string { return cfg.Load().Server.Secret }
	engine = court.NewEngine(cfg.Load(), hub, aiClient, voice, filter)
	engine.AttachMemory(recall)
	engine.SetPunishments(cfg.Load().Courtroom.Punishments)
	casesFile := cfg.Load().Courtroom.CasesFile
	if casesFile == "" {
		casesFile = "cases.yaml"
	}
	if err := engine.LoadCases(casesFile); err != nil {
		log.Printf("case deck unavailable: %v", err)
	}

	var chat atomic.Pointer[bot.TwitchIRC]

	// announce skips empty lines: unconfigured chat templates stay silent
	announce := func(text string) {
		if strings.TrimSpace(text) == "" {
			return
		}
		if c := chat.Load(); c != nil {
			c.SendMessage(text)
		}
	}

	// streamer trials are rare events now: manual starts and platinum donations only
	openStreamerTrial := func(defendant, crime, context string) bool {
		if err := engine.StartTrial(defendant, crime, context); err != nil {
			log.Printf("start trial rejected: %v", err)
			return false
		}
		return true
	}

	// publish persists a mutated config clone and makes it live (RCU).
	publish := func(w http.ResponseWriter, next *config.Config) bool {
		if err := next.Save("config.yaml"); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return false
		}
		cfg.Store(next)
		engine.SwapConfig(next)
		return true
	}
	var voiceMu sync.Mutex

	handleDonation := func(d bot.Donation) {
		if d.Amount <= 0 {
			return
		}
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
		queued := false
		if safety.Banned(d.Message) {
			queued = engine.AddFlaggedWitness(donor, d.Amount, d.Currency, d.Message)
		} else {
			queued = engine.AddWitness(donor, d.Amount, d.Currency, d.Message)
		}
		if queued {
			if isBribe(cfg.Load(), d.Amount, d.Message) {
				engine.AddBribe(donor, d.Amount, d.Currency, d.Message)
			}
			return
		}
		openDonationTrial(cfg.Load(), openStreamerTrial, donor, d.Amount, d.Currency, d.Message)
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
		if !checkHTTPAuth(cfg.Load(), r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		status := map[string]interface{}{
			"status":   "online",
			"state":    engine.GetState(),
			"port":     cfg.Load().Server.Port,
			"ai_live":  cfg.Load().AI.APIKey != "" || cfg.Load().AI.Provider == "ollama",
			"tts_beep": ttsIsBeep(cfg.Load()),
		}
		if modChat := chat.Load(); modChat != nil {
			if modErr, bad := modChat.LastModError(); bad {
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
		if !checkHTTPAuth(cfg.Load(), r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req struct {
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
			req.Defendant = cfg.Load().Game.StreamerName
		}
		if req.Crime == "" {
			req.Crime = cfg.Load().Chat.DefaultCrime
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
		if !checkHTTPAuth(cfg.Load(), r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req struct {
			Text string `json:"text"`
		}
		if err := decodeJSON(w, r, &req); err != nil || req.Text == "" {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		if !limiter.allow("say") {
			http.Error(w, "too many requests", http.StatusTooManyRequests)
			return
		}
		engine.Say(truncateRunes(req.Text, 300))
		w.WriteHeader(http.StatusAccepted)
	})

	mux.HandleFunc("/api/defense", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !checkHTTPAuth(cfg.Load(), r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req struct {
			Author string `json:"author"`
			Text   string `json:"text"`
		}
		if err := decodeJSON(w, r, &req); err != nil || req.Text == "" {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		if req.Author == "" {
			req.Author = "стример"
		}
		if !limiter.allow("defense:" + req.Author) {
			http.Error(w, "too many requests", http.StatusTooManyRequests)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"accepted": engine.AddDefense(req.Author, truncateRunes(req.Text, 600))})
	})

	mux.HandleFunc("/api/profile", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case http.MethodGet:
			if !checkHTTPAuth(cfg.Load(), r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			json.NewEncoder(w).Encode(recall.GetProfile())
		case http.MethodPut:
			if !checkHTTPAuth(cfg.Load(), r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			var p memory.StreamerProfile
			if err := decodeJSON(w, r, &p); err != nil {
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
				"provider":       cfg.Load().AI.Provider,
				"model":          cfg.Load().AI.Model,
				"temperature":    cfg.Load().AI.Temperature,
				"stream":         cfg.Load().AI.Stream,
				"base_url":       cfg.Load().AI.BaseURL,
				"has_key":        cfg.Load().AI.APIKey != "",
				"has_extra_body": len(cfg.Load().AI.ExtraBody) > 0,
				"live":           cfg.Load().AI.APIKey != "" || cfg.Load().AI.Provider == "ollama" || strings.TrimSpace(cfg.Load().AI.BaseURL) != "",
			}
		}
		switch r.Method {
		case http.MethodGet:
			if !checkHTTPAuth(cfg.Load(), r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			json.NewEncoder(w).Encode(aiStatus())
		case http.MethodPut:
			if !checkHTTPAuth(cfg.Load(), r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			var req struct {
				Provider    *string        `json:"provider"`
				APIKey      *string        `json:"api_key"`
				Model       *string        `json:"model"`
				Temperature *float64       `json:"temperature"`
				Stream      *bool          `json:"stream"`
				BaseURL     *string        `json:"base_url"`
				ExtraBody   map[string]any `json:"extra_body"`
			}
			if err := decodeJSON(w, r, &req); err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			next := cfg.Load().Clone()
			if req.Provider != nil {
				if strings.TrimSpace(*req.Provider) == "" {
					http.Error(w, "want non-empty provider", http.StatusBadRequest)
					return
				}
				next.AI.Provider = strings.TrimSpace(*req.Provider)
			}
			if req.APIKey != nil {
				next.AI.APIKey = *req.APIKey
			}
			if req.Model != nil && *req.Model != "" {
				next.AI.Model = *req.Model
			}
			if req.Temperature != nil {
				next.AI.Temperature = *req.Temperature
			}
			if req.BaseURL != nil {
				next.AI.BaseURL = strings.TrimSpace(*req.BaseURL)
			}
			if req.Stream != nil {
				next.AI.Stream = *req.Stream
			}
			if req.ExtraBody != nil {
				if len(req.ExtraBody) > 32 {
					http.Error(w, "extra_body too large", http.StatusBadRequest)
					return
				}
				next.AI.ExtraBody = req.ExtraBody
			}
			if _, err := ai.ResolveEndpoint(next.AI.Provider, next.AI.BaseURL); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			if !publish(w, next) {
				return
			}
			client, err := ai.NewClient(next.AI)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			engine.SetAI(client)
			json.NewEncoder(w).Encode(aiStatus())
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/prompts", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		promptsStatus := func() map[string]any {
			p := cfg.Load().Prompts
			return map[string]any{
				"judge_strict": p.JudgeStrict, "judge_cynical": p.JudgeCynical,
				"prosody": p.Prosody, "task_indictment": p.TaskIndictment,
				"task_counter": p.TaskCounter, "task_deliberation": p.TaskDeliberation,
				"bribe_note": p.BribeNote, "condemn_note": p.CondemnNote,
				"gen_prompt": p.GenPrompt,
			}
		}
		switch r.Method {
		case http.MethodGet:
			if !checkHTTPAuth(cfg.Load(), r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			json.NewEncoder(w).Encode(promptsStatus())
		case http.MethodPut:
			if !checkHTTPAuth(cfg.Load(), r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			var req struct {
				Reset            bool    `json:"reset"`
				JudgeStrict      *string `json:"judge_strict"`
				JudgeCynical     *string `json:"judge_cynical"`
				Prosody          *string `json:"prosody"`
				TaskIndictment   *string `json:"task_indictment"`
				TaskCounter      *string `json:"task_counter"`
				TaskDeliberation *string `json:"task_deliberation"`
				BribeNote        *string `json:"bribe_note"`
				CondemnNote      *string `json:"condemn_note"`
				GenPrompt        *string `json:"gen_prompt"`
			}
			if err := decodeJSON(w, r, &req); err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			next := cfg.Load().Clone()
			if req.Reset {
				next.Prompts = config.DefaultPrompts()
			} else {
				if req.JudgeStrict != nil {
					next.Prompts.JudgeStrict = *req.JudgeStrict
				}
				if req.JudgeCynical != nil {
					next.Prompts.JudgeCynical = *req.JudgeCynical
				}
				if req.Prosody != nil {
					next.Prompts.Prosody = *req.Prosody
				}
				if req.TaskIndictment != nil {
					next.Prompts.TaskIndictment = *req.TaskIndictment
				}
				if req.TaskCounter != nil {
					next.Prompts.TaskCounter = *req.TaskCounter
				}
				if req.TaskDeliberation != nil {
					next.Prompts.TaskDeliberation = *req.TaskDeliberation
				}
				if req.BribeNote != nil {
					next.Prompts.BribeNote = *req.BribeNote
				}
				if req.CondemnNote != nil {
					next.Prompts.CondemnNote = *req.CondemnNote
				}
				if req.GenPrompt != nil {
					next.Prompts.GenPrompt = *req.GenPrompt
				}
			}
			if !publish(w, next) {
				return
			}
			json.NewEncoder(w).Encode(promptsStatus())
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/ai/ping", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !checkHTTPAuth(cfg.Load(), r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
		defer cancel()
		ms, mock, err := engine.PingAI(ctx)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"ms": ms, "mock": mock})
	})

	mux.HandleFunc("/api/tts", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ttsStatus := func() map[string]any {
			return map[string]any{
				"engine":        cfg.Load().TTS.Engine,
				"voice":         cfg.Load().TTS.Voice,
				"rate":          cfg.Load().TTS.Rate,
				"volume":        cfg.Load().TTS.Volume,
				"pitch":         cfg.Load().TTS.Pitch,
				"judge_voice":   cfg.Load().TTS.JudgeVoice,
				"judge_rate":    cfg.Load().TTS.JudgeRate,
				"silero_url":    cfg.Load().TTS.SileroURL,
				"silero_judge":  cfg.Load().TTS.SileroJudge,
				"enabled":       cfg.Load().TTS.Enabled,
				"auto_fallback": cfg.Load().TTS.AutoFallback,
				"beep":          ttsIsBeep(cfg.Load()),
				"piper_binary":  cfg.Load().TTS.PiperBinary,
				"model_path":    cfg.Load().TTS.ModelPath,
				"config_path":   cfg.Load().TTS.ConfigPath,
				"speaker_id":    cfg.Load().TTS.SpeakerID,
				"speed":         cfg.Load().TTS.Speed,
				"voices": map[string]any{
					"edge":   []string{"ru-RU-SvetlanaNeural", "ru-RU-DmitryNeural"},
					"silero": []string{"xenia", "kseniya", "baya", "aidar", "eugene"},
					"piper":  []string{"ru_irina", "ru_dmitri", "ru_ruslan", "ru_denis"},
				},
			}
		}
		switch r.Method {
		case http.MethodGet:
			if !checkHTTPAuth(cfg.Load(), r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			json.NewEncoder(w).Encode(ttsStatus())
		case http.MethodPut:
			if !checkHTTPAuth(cfg.Load(), r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			var req struct {
				Engine       *string  `json:"engine"`
				Voice        *string  `json:"voice"`
				Rate         *string  `json:"rate"`
				Volume       *string  `json:"volume"`
				Pitch        *string  `json:"pitch"`
				JudgeVoice   *string  `json:"judge_voice"`
				JudgeRate    *string  `json:"judge_rate"`
				SileroURL    *string  `json:"silero_url"`
				SileroJudge  *string  `json:"silero_judge"`
				Enabled      *bool    `json:"enabled"`
				AutoFallback *bool    `json:"auto_fallback"`
				PiperBinary  *string  `json:"piper_binary"`
				ModelPath    *string  `json:"model_path"`
				ConfigPath   *string  `json:"config_path"`
				SpeakerID    *int     `json:"speaker_id"`
				Speed        *float64 `json:"speed"`
			}
			if err := decodeJSON(w, r, &req); err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			next := cfg.Load().Clone()
			if req.Engine != nil {
				switch *req.Engine {
				case "edge", "silero", "piper", "mock":
					next.TTS.Engine = *req.Engine
				default:
					http.Error(w, "want engine edge, silero, piper or mock", http.StatusBadRequest)
					return
				}
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
			voiceMu.Lock()
			old := voice
			voice = buildSynthesizer(next)
			engine.SetVoice(voice)
			_ = old.Close()
			voiceMu.Unlock()
			json.NewEncoder(w).Encode(ttsStatus())
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/history", func(w http.ResponseWriter, r *http.Request) {
		if !checkHTTPAuth(cfg.Load(), r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"trials": recall.RecentTrials(10),
			"top":    recall.TopAccusers(5),
		})
	})

	mux.HandleFunc("/api/unban", func(w http.ResponseWriter, r *http.Request) {
		if !checkHTTPAuth(cfg.Load(), r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
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
		if !checkHTTPAuth(cfg.Load(), r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req struct {
			ID      string `json:"id"`
			Approve bool   `json:"approve"`
			Text    string `json:"text"`
		}
		if err := decodeJSON(w, r, &req); err != nil || req.ID == "" {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		if err := unbanCourt.Load().Resolve(ctx, req.ID, req.Approve, req.Text); err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		unbanBoard.refresh(context.Background(), unbanCourt.Load())
		w.WriteHeader(http.StatusAccepted)
	})

	mux.HandleFunc("/api/unban/trial", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !checkHTTPAuth(cfg.Load(), r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req struct {
			ID string `json:"id"`
		}
		if err := decodeJSON(w, r, &req); err != nil || req.ID == "" {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		var found *bot.UnbanRequest
		for _, u := range unbanBoard.list() {
			if u.ID == req.ID {
				u := u
				found = &u
				break
			}
		}
		if found == nil {
			http.Error(w, "unknown appeal", http.StatusNotFound)
			return
		}
		user := found.UserName
		if user == "" {
			user = found.UserLogin
		}
		if err := engine.StartUnbanTrial(user, found.Text); err != nil {
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	})

	mux.HandleFunc("/api/dock", func(w http.ResponseWriter, r *http.Request) {
		if !checkHTTPAuth(cfg.Load(), r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
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
		if !checkHTTPAuth(cfg.Load(), r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req struct {
			Nick string `json:"nick"`
		}
		if err := decodeJSON(w, r, &req); err != nil {
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
			crime = cfg.Load().Chat.DefaultCrime
		}
		if err := engine.StartViewerTrial(seat.Nick, crime); err != nil {
			engine.ReturnSeat(seat)
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
		if !checkHTTPAuth(cfg.Load(), r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		engine.AbortTrial()
		if seat, ok := engine.PickRandom(); ok {
			crime := seat.Reason
			if crime == "" {
				crime = cfg.Load().Chat.DefaultCrime
			}
			if err := engine.StartViewerTrial(seat.Nick, crime); err == nil {
				json.NewEncoder(w).Encode(map[string]any{"defendant": seat.Nick})
				return
			}
			engine.ReturnSeat(seat)
		}
		json.NewEncoder(w).Encode(map[string]any{"defendant": ""})
	})

	mux.HandleFunc("/api/cases", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		deck := engine.CaseDeck()
		if deck == nil {
			http.Error(w, "no case deck", http.StatusConflict)
			return
		}
		switch r.Method {
		case http.MethodGet:
			if !checkHTTPAuth(cfg.Load(), r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			used := map[string]bool{}
			for _, id := range recall.UsedCases() {
				used[id] = true
			}
			type cardView struct {
				court.CaseCard
				Used bool `json:"used"`
			}
			list := deck.List()
			out := make([]cardView, 0, len(list))
			for _, c := range list {
				out = append(out, cardView{CaseCard: c, Used: used[c.ID]})
			}
			json.NewEncoder(w).Encode(map[string]any{"cases": out, "remaining": deck.Remaining()})
		case http.MethodPost:
			if !checkHTTPAuth(cfg.Load(), r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			var req struct {
				Title   string   `json:"title"`
				Crime   string   `json:"crime"`
				Context string   `json:"context"`
				Tags    []string `json:"tags"`
			}
			if err := decodeJSON(w, r, &req); err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			card, err := deck.Add(req.Title, req.Crime, req.Context, req.Tags, "hand")
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			json.NewEncoder(w).Encode(card)
		case http.MethodDelete:
			if !checkHTTPAuth(cfg.Load(), r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			if err := deck.Delete(r.URL.Query().Get("id")); err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"ok": true})
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/cases/draw", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !checkHTTPAuth(cfg.Load(), r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		deck := engine.CaseDeck()
		if deck == nil {
			http.Error(w, "no case deck", http.StatusConflict)
			return
		}
		var req struct {
			Target string `json:"target"`
			Start  bool   `json:"start"`
		}
		if err := decodeJSON(w, r, &req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		defendant := ""
		viewer := true
		if req.Target == "streamer" {
			viewer = false
			defendant = cfg.Load().Game.StreamerName
		} else {
			authors := engine.RecentAuthors(10)
			if len(authors) == 0 {
				http.Error(w, "chat is silent: pick a defendant or try the streamer", http.StatusConflict)
				return
			}
			defendant = authors[rand.Intn(len(authors))]
		}
		if defendant == "" {
			http.Error(w, "no defendant", http.StatusConflict)
			return
		}
		card, ok := deck.Draw()
		if !ok {
			if cfg.Load().Courtroom.CasesGen.Enabled {
				batch := cfg.Load().Courtroom.CasesGen.Batch
				if batch <= 0 {
					batch = 5
				}
				engine.GenerateCasesAsync(batch)
				http.Error(w, "deck is empty, generation started", http.StatusConflict)
			} else {
				http.Error(w, "deck is empty", http.StatusConflict)
			}
			return
		}
		if req.Start {
			if trialErr := engine.StartCaseTrial(defendant, card, viewer); trialErr != nil {
				deck.Return(card)
				http.Error(w, trialErr.Error(), http.StatusConflict)
				return
			}
		}
		json.NewEncoder(w).Encode(map[string]any{
			"case": card, "defendant": defendant, "remaining": deck.Remaining(),
		})
		go engine.EnsureRefill()
	})

	mux.HandleFunc("/api/cases/reset", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !checkHTTPAuth(cfg.Load(), r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		deck := engine.CaseDeck()
		if deck == nil {
			http.Error(w, "no case deck", http.StatusConflict)
			return
		}
		deck.Reset()
		json.NewEncoder(w).Encode(map[string]any{"remaining": deck.Remaining()})
	})

	mux.HandleFunc("/api/cases/generate", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if !checkHTTPAuth(cfg.Load(), r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		switch r.Method {
		case http.MethodGet:
			st := engine.GenStatus()
			remaining := 0
			if deck := engine.CaseDeck(); deck != nil {
				remaining = deck.Remaining()
			}
			json.NewEncoder(w).Encode(map[string]any{
				"running": st.Running, "added": st.Added,
				"error": st.Error, "remaining": remaining,
			})
		case http.MethodPost:
			var req struct {
				Count int `json:"count"`
			}
			if err := decodeJSON(w, r, &req); err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			if req.Count <= 0 {
				req.Count = cfg.Load().Courtroom.CasesGen.Batch
			}
			if !engine.GenerateCasesAsync(req.Count) {
				http.Error(w, "generation already running", http.StatusConflict)
				return
			}
			w.WriteHeader(http.StatusAccepted)
			json.NewEncoder(w).Encode(map[string]any{"started": true})
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/moderate", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !checkHTTPAuth(cfg.Load(), r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req struct {
			User   string `json:"user"`
			Action string `json:"action"`
			Secs   int    `json:"secs"`
			Reason string `json:"reason"`
		}
		if err := decodeJSON(w, r, &req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		if !validNick.MatchString(req.User) {
			http.Error(w, "bad nick", http.StatusBadRequest)
			return
		}
		c := chat.Load()
		if c == nil {
			http.Error(w, "chat offline", http.StatusConflict)
			return
		}
		switch req.Action {
		case "ban":
			c.Ban(req.User)
		case "timeout":
			secs := req.Secs
			if secs <= 0 {
				secs = 60
			}
			if secs > 1209600 {
				secs = 1209600
			}
			c.Timeout(req.User, secs)
		case "pardon":
			c.Unban(req.User)
		default:
			http.Error(w, "want action ban, timeout or pardon", http.StatusBadRequest)
			return
		}
		log.Printf("manual moderation: %s %s", req.Action, req.User)
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
	})

	mux.HandleFunc("/api/panic", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !checkHTTPAuth(cfg.Load(), r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		engine.TriggerPanic()
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
	})

	mux.HandleFunc("/api/punish", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !checkHTTPAuth(cfg.Load(), r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req struct {
			Kind string `json:"kind"`
			Secs int    `json:"secs"`
		}
		if err := decodeJSON(w, r, &req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"punishment": engine.SetPunishment(req.Kind, req.Secs)})
	})

	mux.HandleFunc("/api/integrations", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		integrationsStatus := func() map[string]any {
			return map[string]any{
				"donationalerts":         cfg.Load().Donations.DonationAlerts.Token != "",
				"donatepay":              cfg.Load().Donations.DonatePay.APIKey != "",
				"twitch":                 cfg.Load().Twitch.Token != "",
				"channel":                cfg.Load().Twitch.Channel,
				"nick":                   cfg.Load().Twitch.Nick,
				"client_id":              cfg.Load().Twitch.ClientID,
				"broadcaster_id":         cfg.Load().Twitch.BroadcasterID,
				"moderator_id":           cfg.Load().Twitch.ModeratorID,
				"donationalerts_enabled": cfg.Load().Donations.DonationAlerts.Enabled,
				"donatepay_enabled":      cfg.Load().Donations.DonatePay.Enabled,
				"twitch_bits_enabled":    cfg.Load().Donations.TwitchBits.Enabled,
			}
		}
		switch r.Method {
		case http.MethodGet:
			if !checkHTTPAuth(cfg.Load(), r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			json.NewEncoder(w).Encode(integrationsStatus())
		case http.MethodPut:
			if !checkHTTPAuth(cfg.Load(), r) {
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
				ModeratorID    *string `json:"moderator_id"`
				DonationsToken *string `json:"donations_token"`
				DAEnabled      *bool   `json:"donationalerts_enabled"`
				DPEnabled      *bool   `json:"donatepay_enabled"`
				BitsEnabled    *bool   `json:"twitch_bits_enabled"`
			}
			if err := decodeJSON(w, r, &req); err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			next := cfg.Load().Clone()
			if req.DonationAlerts != nil {
				next.Donations.Token = *req.DonationAlerts
				next.Donations.DonationAlerts.Token = *req.DonationAlerts
			}
			if req.DonatePay != nil {
				next.Donations.DonatePay.APIKey = *req.DonatePay
			}
			if req.TwitchToken != nil {
				next.Twitch.Token = *req.TwitchToken
			}
			if req.Channel != nil && *req.Channel != "" {
				next.Twitch.Channel = *req.Channel
			}
			if req.Nick != nil && *req.Nick != "" {
				next.Twitch.Nick = *req.Nick
			}
			if req.ClientID != nil {
				next.Twitch.ClientID = *req.ClientID
			}
			if req.BroadcasterID != nil {
				next.Twitch.BroadcasterID = *req.BroadcasterID
				if next.Twitch.ModeratorID == "" {
					next.Twitch.ModeratorID = *req.BroadcasterID
				}
			}
			if req.ModeratorID != nil && *req.ModeratorID != "" {
				next.Twitch.ModeratorID = *req.ModeratorID
			}
			if req.DonationsToken != nil {
				next.Donations.Token = *req.DonationsToken
			}
			if req.DAEnabled != nil {
				next.Donations.DonationAlerts.Enabled = *req.DAEnabled
			}
			if req.DPEnabled != nil {
				next.Donations.DonatePay.Enabled = *req.DPEnabled
			}
			if req.BitsEnabled != nil {
				next.Donations.TwitchBits.Enabled = *req.BitsEnabled
			}
			if !publish(w, next) {
				return
			}
			donateGate.SetMinimums(next.Donations.MinAmounts, next.Donations.DefaultMin)
			unbanCourt.Store(bot.NewUnbanClient(next.Twitch.Token, next.Twitch.ClientID, next.Twitch.BroadcasterID, next.Twitch.ModeratorID))
			startWatchers()
			json.NewEncoder(w).Encode(integrationsStatus())
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/judge/photo", func(w http.ResponseWriter, r *http.Request) {
		// single judge portrait: ?state= is accepted for old overlays but ignored
		switch r.Method {
		case http.MethodGet:
			serveJudgePhoto(w, r)
		case http.MethodPost:
			if !checkHTTPAuth(cfg.Load(), r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, 9<<20)
			if err := r.ParseMultipartForm(9 << 20); err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			if err := saveJudgePhoto(r); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/court/photo", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			serveCourtBg(w, r)
		case http.MethodPost:
			if !checkHTTPAuth(cfg.Load(), r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, 9<<20)
			if err := r.ParseMultipartForm(9 << 20); err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			if err := saveCourtBg(r); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		case http.MethodDelete:
			if !checkHTTPAuth(cfg.Load(), r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			_ = os.Remove(courtBgPath())
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
		if !checkHTTPAuth(cfg.Load(), r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
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
		if fi, err := os.Stat(judgePhotoPath()); err == nil && !fi.IsDir() {
			judge["judge"] = true
		}
		json.NewEncoder(w).Encode(map[string]any{"sfx": files, "judge": judge})
	})

	mux.HandleFunc("/api/donate", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !checkHTTPAuth(cfg.Load(), r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req struct {
			Donor    string  `json:"donor"`
			Amount   float64 `json:"amount"`
			Currency string  `json:"currency"`
			Message  string  `json:"message"`
		}
		if err := decodeJSON(w, r, &req); err != nil || req.Amount <= 0 {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		req.Donor = truncateRunes(req.Donor, 64)
		req.Currency = truncateRunes(req.Currency, 16)
		req.Message = truncateRunes(req.Message, 500)
		handleDonation(bot.Donation{Donor: req.Donor, Amount: req.Amount, Currency: req.Currency, Message: req.Message})
		w.WriteHeader(http.StatusAccepted)
	})

	gameCtx, stopGame := context.WithCancel(context.Background())
	defer stopGame()

	mux.HandleFunc("/api/settings", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case http.MethodGet:
			if !checkHTTPAuth(cfg.Load(), r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			json.NewEncoder(w).Encode(map[string]any{
				"min_amounts":        cfg.Load().Donations.MinAmounts,
				"default_min":        cfg.Load().Donations.DefaultMin,
				"streamer_trial_min": cfg.Load().Donations.StreamerTrialMin,
				"platinum_min":       cfg.Load().Donations.PlatinumMin,
				"judge_name":         cfg.Load().Courtroom.JudgeName,
				"theme":              cfg.Load().Courtroom.Theme,
				"punishments":        cfg.Load().Courtroom.Punishments,
				"judge_style":        cfg.Load().Courtroom.JudgeStyle,
				"defense_sec":        cfg.Load().Courtroom.DefenseSec,
				"testimony_sec":      cfg.Load().Courtroom.TestimonySec,
				"sue_threshold":      cfg.Load().Courtroom.SueThreshold,
				"sue_window_sec":     cfg.Load().Courtroom.SueWindowSec,
				"articles":           cfg.Load().Courtroom.Articles,
			})
		case http.MethodPut:
			if !checkHTTPAuth(cfg.Load(), r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			var req struct {
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
				Articles         []string           `json:"articles"`
			}
			if err := decodeJSON(w, r, &req); err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			next := cfg.Load().Clone()
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
				engine.SetPunishments(req.Punishments)
			}
			if req.Articles != nil {
				next.Courtroom.Articles = req.Articles
			}
			if req.JudgeStyle != nil {
				if *req.JudgeStyle == "cynical" {
					next.Courtroom.JudgeStyle = "cynical"
				} else {
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
			if !publish(w, next) {
				return
			}
			donateGate.SetMinimums(next.Donations.MinAmounts, next.Donations.DefaultMin)
			json.NewEncoder(w).Encode(map[string]any{
				"min_amounts":        next.Donations.MinAmounts,
				"default_min":        next.Donations.DefaultMin,
				"streamer_trial_min": next.Donations.StreamerTrialMin,
				"platinum_min":       next.Donations.PlatinumMin,
				"judge_name":         next.Courtroom.JudgeName,
				"theme":              next.Courtroom.Theme,
				"punishments":        next.Courtroom.Punishments,
				"judge_style":        next.Courtroom.JudgeStyle,
				"defense_sec":        next.Courtroom.DefenseSec,
				"testimony_sec":      next.Courtroom.TestimonySec,
				"sue_threshold":      next.Courtroom.SueThreshold,
				"sue_window_sec":     next.Courtroom.SueWindowSec,
				"articles":           next.Courtroom.Articles,
			})
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/safety", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		safetyStatus := func() map[string]any {
			return map[string]any{
				"filter_enabled":   cfg.Load().Safety.FilterEnabled,
				"custom_blacklist": cfg.Load().Safety.CustomBlacklist,
				"panic_hotkey":     cfg.Load().Safety.PanicHotkey,
				"ban_confirm":      cfg.Load().Safety.BanConfirm,
			}
		}
		switch r.Method {
		case http.MethodGet:
			if !checkHTTPAuth(cfg.Load(), r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			json.NewEncoder(w).Encode(safetyStatus())
		case http.MethodPut:
			if !checkHTTPAuth(cfg.Load(), r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			var req struct {
				FilterEnabled   *bool    `json:"filter_enabled"`
				CustomBlacklist []string `json:"custom_blacklist"`
				PanicHotkey     *string  `json:"panic_hotkey"`
				BanConfirm      *bool    `json:"ban_confirm"`
			}
			if err := decodeJSON(w, r, &req); err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			next := cfg.Load().Clone()
			if req.FilterEnabled != nil {
				next.Safety.FilterEnabled = *req.FilterEnabled
			}
			if req.CustomBlacklist != nil {
				clean := make([]string, 0, len(req.CustomBlacklist))
				for _, item := range req.CustomBlacklist {
					if trimmed := strings.TrimSpace(item); trimmed != "" {
						clean = append(clean, trimmed)
					}
				}
				next.Safety.CustomBlacklist = clean
			}
			if req.PanicHotkey != nil {
				switch strings.ToLower(strings.TrimSpace(*req.PanicHotkey)) {
				case "escape", "f9", "f12", "p":
					next.Safety.PanicHotkey = strings.ToLower(strings.TrimSpace(*req.PanicHotkey))
				default:
					http.Error(w, "want panic_hotkey escape, f9, f12 or p", http.StatusBadRequest)
					return
				}
			}
			if req.BanConfirm != nil {
				next.Safety.BanConfirm = *req.BanConfirm
			}
			if !publish(w, next) {
				return
			}
			filter.SetEnabled(next.Safety.FilterEnabled)
			filter.SetBlacklist(next.Safety.CustomBlacklist)
			json.NewEncoder(w).Encode(safetyStatus())
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/game", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case http.MethodGet:
			if !checkHTTPAuth(cfg.Load(), r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			json.NewEncoder(w).Encode(map[string]any{
				"streamer_name": cfg.Load().Game.StreamerName,
				"memory_path":   cfg.Load().Game.MemoryPath,
			})
		case http.MethodPut:
			if !checkHTTPAuth(cfg.Load(), r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			var req struct {
				StreamerName *string `json:"streamer_name"`
			}
			if err := decodeJSON(w, r, &req); err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			next := cfg.Load().Clone()
			if req.StreamerName != nil && strings.TrimSpace(*req.StreamerName) != "" {
				next.Game.StreamerName = strings.TrimSpace(*req.StreamerName)
			}
			if !publish(w, next) {
				return
			}
			json.NewEncoder(w).Encode(map[string]any{
				"streamer_name": next.Game.StreamerName,
				"memory_path":   next.Game.MemoryPath,
			})
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/server", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !checkHTTPAuth(cfg.Load(), r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{
			"host":         cfg.Load().Server.Host,
			"port":         cfg.Load().Server.Port,
			"secret_set":   cfg.Load().Server.Secret != "",
			"restart_hint": "смена host/port/secret требует рестарта",
		})
	})

	mux.HandleFunc("/api/restart", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !checkHTTPAuth(cfg.Load(), r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"restarting": true})
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		go func() {
			time.Sleep(500 * time.Millisecond)
			if err := srv.Shutdown(context.Background()); err != nil {
				log.Printf("restart shutdown: %v", err)
			}
		}()
	})

	// !sue flashmob: chat votes the streamer onto the bench
	sueTracker := court.NewSueTracker()
	var suePending atomic.Bool
	trySueTrial := func(crime string) {
		if engine.GetState() != court.StateIdle {
			if suePending.CompareAndSwap(false, true) {
				announce(tmpl.Fill(cfg.Load().Chat.StreamerNext, map[string]string{"crime": crime}))
			}
			return
		}
		suePending.Store(false)
		sueTracker.Reset()
		openStreamerTrial(cfg.Load().Game.StreamerName, crime, cfg.Load().Chat.SueContext)
	}

	// chatHandler routes every chat line; chat itself is rebuilt on token change
	chatHandler := func(cmd bot.ChatCommand) {
		switch cmd.Kind {
		case bot.CommandCourt:
			if joined, pos := engine.JoinPool(cmd.Author, cmd.Argument); joined {
				announce(tmpl.Fill(cfg.Load().Chat.QueueJoined, map[string]string{
					"author": cmd.Author, "position": strconv.Itoa(pos),
				}))
			}
		case bot.CommandLeave:
			if engine.LeavePool(cmd.Author) {
				announce(tmpl.Fill(cfg.Load().Chat.QueueLeft, map[string]string{"author": cmd.Author}))
			}
		case bot.CommandCrime:
			if cmd.Argument != "" {
				engine.AddChatComment(cmd.Author, "!crime "+cmd.Argument)
				if err := engine.StartViewerTrial(cmd.Author, cmd.Argument); err == nil {
					announce(tmpl.Fill(cfg.Load().Chat.SelfTrial, map[string]string{"author": cmd.Author}))
				}
			}
		case bot.CommandSnitch:
			if cmd.Argument != "" {
				engine.AddChatComment(cmd.Author, "!snitch "+cmd.Argument)
			}
		case bot.CommandSue:
			if cfg.Load().Courtroom.SueThreshold <= 0 {
				break
			}
			window := time.Duration(cfg.Load().Courtroom.SueWindowSec) * time.Second
			if window <= 0 {
				window = 10 * time.Minute
			}
			if n := sueTracker.Add(cmd.Author, cmd.Argument, time.Now(), window); n >= cfg.Load().Courtroom.SueThreshold {
				trySueTrial(sueTracker.TopReason())
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
		if cfg.Load().Donations.DonationAlerts.Enabled && cfg.Load().Donations.DonationAlerts.Token != "" {
			daWatcher := bot.NewDonationsWatcher(cfg.Load().Donations.DonationAlerts.Token, handleDonation)
			go daWatcher.Run(wctx)
			log.Println("donationalerts watcher started")
		}
		if cfg.Load().Donations.DonatePay.Enabled && cfg.Load().Donations.DonatePay.APIKey != "" {
			dpWatcher := bot.NewDonatePayWatcher(cfg.Load().Donations.DonatePay.APIKey, handleDonation)
			go dpWatcher.Run(wctx)
			log.Println("donatepay watcher started")
		}
		if cfg.Load().Donations.TwitchBits.Enabled {
			bitsWatcher := bot.NewEventSubWatcher(cfg.Load().Twitch.Token, cfg.Load().Twitch.ClientID, cfg.Load().Twitch.BroadcasterID, func(event bot.DonationEvent) {
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
		if cfg.Load().Twitch.Token != "" && cfg.Load().Twitch.ClientID != "" && cfg.Load().Twitch.BroadcasterID != "" {
			go unbanBoard.watch(wctx, unbanCourt.Load())
			log.Println("unban court watcher started")
		}
		chat.Store(bot.NewTwitchIRC(cfg.Load().Twitch.Channel, cfg.Load().Twitch.Nick, cfg.Load().Twitch.Token, chatHandler))
		go chat.Load().Run(wctx)
		if cfg.Load().Twitch.Token != "" && cfg.Load().Twitch.Channel != "" {
			log.Printf("twitch chat on #%s as %s", cfg.Load().Twitch.Channel, cfg.Load().Twitch.Nick)
		}
	}
	startWatchers()

	engine.VerdictHook = func(verdict, penalty string, guilty, innocent int, twist string) {
		announce(tmpl.Fill(cfg.Load().Chat.VerdictLine, map[string]string{
			"verdict": verdict,
			"guilty":  strconv.Itoa(guilty), "innocent": strconv.Itoa(innocent),
			"penalty": penalty, "twist": twist,
		}))
		if suePending.CompareAndSwap(true, false) {
			crime := sueTracker.TopReason()
			sueTracker.Reset()
			openStreamerTrial(cfg.Load().Game.StreamerName, crime, cfg.Load().Chat.SueContext)
		}
	}

	engine.TimeoutHook = func(user string, secs int, ban bool, reason string) {
		if !validNick.MatchString(user) {
			log.Printf("refusing moderation on bad nick %q", user)
			return
		}
		c := chat.Load()
		if c == nil {
			return
		}
		if ban {
			c.Ban(user)
			return
		}
		c.Timeout(user, secs)
	}

	engine.SetPunishments(cfg.Load().Courtroom.Punishments)

	mux.HandleFunc("/favicon.ico", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	addr := fmt.Sprintf("%s:%d", cfg.Load().Server.Host, cfg.Load().Server.Port)
	if cfg.Load().Server.Secret == "" && cfg.Load().Server.Host != "127.0.0.1" && cfg.Load().Server.Host != "localhost" {
		log.Fatalf("refusing to serve on %s without secret: set server.secret or TRIBUNAL_SECRET", addr)
	}
	srv = &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}

	go func() {
		log.Printf("Stream Tribunal server running at http://%s", addr)
		log.Printf("OBS overlays: http://%s/overlay/ and http://%s/overlay/judge.html", addr, addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("http server error: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	log.Println("shutting down server...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("server forced to shutdown: %v", err)
	}
	log.Println("server stopped cleanly")
}
