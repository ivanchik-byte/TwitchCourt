package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
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
	"stream-tribunal/internal/game"
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

	var engine *court.Engine

	limiter := newActionLimiter(500 * time.Millisecond)
	sueTracker := bot.NewSueTracker(cfg.Courtroom.SueThreshold, time.Minute, 3*time.Minute)
	donateGate := bot.NewGate(cfg.Donations.MinAmounts, cfg.Donations.DefaultMin)
	pacing := court.NewPacing(time.Duration(cfg.Courtroom.CooldownMin) * time.Minute)

	var requestTrial func(defendant, crime, context string, force bool)
	var chargeTrial func(points int, defendant, crime, context string) bool

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
				requestTrial(req.Defendant, req.Crime, req.Context, true)
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
		case "vote":
			var voteReq struct {
				Voter    string `json:"voter"`
				IsGuilty bool   `json:"is_guilty"`
			}
			if err := json.Unmarshal(payload, &voteReq); err == nil {
				if voteReq.Voter == "" || !limiter.allow("vote:"+voteReq.Voter) {
					return
				}
				engine.CastVote(voteReq.Voter, voteReq.IsGuilty)
			}
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
		case "sue":
			var sueReq struct {
				Author string `json:"author"`
			}
			if err := json.Unmarshal(payload, &sueReq); err == nil {
				if sueReq.Author == "" || !limiter.allow("sue:"+sueReq.Author) {
					return
				}
				recall.AddSueCall(sueReq.Author)
				engine.AddChatComment(sueReq.Author, "!sue")
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

	// requestTrial opens a trial right away. Force bypasses the pacing
	// gate and is reserved for streamer intent and platinum donations.
	requestTrial = func(defendant, crime, context string, force bool) {
		if !force && !pacing.Ready(time.Now()) {
			log.Printf("trial suppressed by cooldown")
			return
		}
		if err := engine.StartTrial(defendant, crime, context); err != nil {
			log.Printf("start trial rejected: %v", err)
			return
		}
		pacing.MarkTrial(time.Now())
		sueTracker.MarkTrial(time.Now())
	}

	// chargeTrial banks suspicion points and opens the trial at 100%.
	// Milestones go to the overlay as a forming-case tease.
	// It reports whether a trial opened.
	chargeTrial = func(points int, defendant, crime, context string) bool {
		idle := engine.GetState() == court.StateIdle
		fired, meter, milestone := pacing.Add(points, time.Now(), idle)
		if milestone > 0 {
			hub.BroadcastEvent(obs.EventSuspicion, obs.SuspicionPayload{Meter: meter, Milestone: milestone})
		}
		if fired {
			requestTrial(defendant, crime, context, false)
			return true
		}
		return false
	}

	openDonationTrial := func(donor string, d bot.DonationEvent) {
		crime := "Донат с требованием суда"
		if strings.TrimSpace(d.Message) != "" {
			crime = "Донат: " + strings.TrimSpace(d.Message)
		}
		context := "Донат " + strconv.FormatFloat(d.Amount, 'f', -1, 64) + " " + d.Currency + " от " + donor
		if d.Amount >= cfg.Donations.PlatinumMin && cfg.Donations.PlatinumMin > 0 {
			pacing.Force(time.Now())
			requestTrial(cfg.Game.StreamerName, crime, context, true)
			return
		}
		chargeTrial(court.PointsDonation, cfg.Game.StreamerName, crime, context)
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
		// Active trial: the donation joins as witness testimony instead
		// of opening a competing case. Speech is never interrupted.
		if engine.AddWitness(donor, d.Amount, d.Currency, d.Message) {
			return
		}
		openDonationTrial(donor, event)
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
	dashboardHandler := http.FileServer(http.FS(dashboardSub))
	mux.Handle("/admin/", http.StripPrefix("/admin/", dashboardHandler))
	mux.HandleFunc("/settings", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/settings.html", http.StatusMovedPermanently)
	})
	mux.HandleFunc("/modes", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/modes.html", http.StatusMovedPermanently)
	})
	mux.Handle("/", dashboardHandler)

	mux.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "online",
			"state":  engine.GetState(),
			"meter":  pacing.Meter(),
			"port":   cfg.Server.Port,
		})
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
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		if req.Defendant == "" {
			req.Defendant = cfg.Game.StreamerName
		}
		if err := engine.StartTrial(req.Defendant, req.Crime, req.Context); err != nil {
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		pacing.MarkTrial(time.Now())
		sueTracker.MarkTrial(time.Now())
		w.WriteHeader(http.StatusAccepted)
	})

	mux.HandleFunc("/api/verdict", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !checkHTTPAuth(cfg, r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req struct {
			Guilty bool `json:"guilty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		if !engine.ForceVerdict(req.Guilty) {
			http.Error(w, "no voting in progress", http.StatusConflict)
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

	mux.HandleFunc("/api/history", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"trials": recall.RecentTrials(10),
			"top":    recall.TopAccusers(5),
		})
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

	var (
		mcWatcherMu sync.Mutex
		mcWatcher   *game.Watcher
	)
	startMinecraftWatcher := func(logPath string, nicks []string) {
		mcWatcherMu.Lock()
		defer mcWatcherMu.Unlock()
		if mcWatcher != nil {
			mcWatcher.SetLogPath(logPath)
			mcWatcher.SetNicks(nicks)
			return
		}
		if logPath == "" {
			return
		}
		mcWatcher = game.NewWatcherWithNicks(logPath, nicks, func(d game.Death) {
			points := court.PointsDeath
			if strings.Contains(strings.ToLower(d.Crime), "лав") {
				points = court.PointsEpicFail
			}
			chargeTrial(points, cfg.Game.StreamerName, d.Crime, d.Context)
		})
		go mcWatcher.Run(gameCtx)
		log.Printf("minecraft watcher on %s", logPath)
	}

	if cfg.Game.MinecraftLog != "" {
		startMinecraftWatcher(cfg.Game.MinecraftLog, cfg.Game.MinecraftNicks)
	}

	mux.HandleFunc("/api/game/minecraft/detect", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		targetPath := cfg.Game.MinecraftLog
		var candidates []string
		if targetPath == "" {
			targetPath, candidates = game.FindDefaultMinecraftLog()
		} else {
			_, candidates = game.FindDefaultMinecraftLog()
		}
		found := false
		if targetPath != "" {
			if fi, err := os.Stat(targetPath); err == nil && !fi.IsDir() {
				found = true
			}
		}
		json.NewEncoder(w).Encode(map[string]any{
			"found":      found,
			"path":       targetPath,
			"candidates": candidates,
		})
	})

	const cs2GSIConfig = `"Stream Tribunal GSI"
{
    "uri" "http://127.0.0.1:7890/api/game/cs2/gsi"
    "timeout" "5.0"
    "buffer"  "0.1"
    "throttle" "0.1"
    "heartbeat" "15.0"
    "data"
    {
        "provider"            "1"
        "map"                 "1"
        "round"               "1"
        "player_id"           "1"
        "player_state"        "1"
        "player_weapons"      "1"
        "player_match_stats"  "1"
    }
}
`
	mux.HandleFunc("/api/game/cs2/cfg", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Content-Disposition", "attachment; filename=\"gamestate_integration_tribunal.cfg\"")
		w.Write([]byte(cs2GSIConfig))
	})

	mux.HandleFunc("/api/game/cs2/gsi", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var payload struct {
			Player struct {
				Name    string `json:"name"`
				SteamID string `json:"steamid"`
				State   struct {
					Health int `json:"health"`
				} `json:"state"`
			} `json:"player"`
			Round struct {
				Phase string `json:"phase"`
			} `json:"round"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err == nil {
			if payload.Player.State.Health == 0 && payload.Player.Name != "" {
				defendant := payload.Player.Name
				if cfg.Game.StreamerName != "" {
					defendant = cfg.Game.StreamerName
				}
				chargeTrial(court.PointsDeath, defendant, "Гибель в раунде CS2", "Valve GSI telemetry")
			}
		}
		w.WriteHeader(http.StatusOK)
	})

	mux.HandleFunc("/api/settings", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case http.MethodGet:
			json.NewEncoder(w).Encode(map[string]any{
				"min_amounts":     cfg.Donations.MinAmounts,
				"default_min":     cfg.Donations.DefaultMin,
				"punishments":     cfg.Courtroom.Punishments,
				"minecraft_log":   cfg.Game.MinecraftLog,
				"minecraft_nicks": cfg.Game.MinecraftNicks,
			})
		case http.MethodPut:
			if !checkHTTPAuth(cfg, r) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			var req struct {
				MinAmounts     map[string]float64 `json:"min_amounts"`
				DefaultMin     *float64           `json:"default_min"`
				Punishments    []string           `json:"punishments"`
				MinecraftLog   *string            `json:"minecraft_log"`
				MinecraftNicks []string           `json:"minecraft_nicks"`
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
			if req.MinecraftLog != nil {
				cfg.Game.MinecraftLog = *req.MinecraftLog
			}
			if req.MinecraftNicks != nil {
				cfg.Game.MinecraftNicks = req.MinecraftNicks
			}
			startMinecraftWatcher(cfg.Game.MinecraftLog, cfg.Game.MinecraftNicks)
			donateGate.SetMinimums(cfg.Donations.MinAmounts, cfg.Donations.DefaultMin)
			json.NewEncoder(w).Encode(map[string]any{
				"min_amounts":     cfg.Donations.MinAmounts,
				"default_min":     cfg.Donations.DefaultMin,
				"punishments":     cfg.Courtroom.Punishments,
				"minecraft_log":   cfg.Game.MinecraftLog,
				"minecraft_nicks": cfg.Game.MinecraftNicks,
			})
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	if cfg.Donations.DonationAlerts.Enabled && cfg.Donations.DonationAlerts.Token != "" {
		daWatcher := bot.NewDonationsWatcher(cfg.Donations.DonationAlerts.Token, handleDonation)
		go daWatcher.Run(gameCtx)
		log.Println("donationalerts watcher started")
	}
	if cfg.Donations.DonatePay.Enabled && cfg.Donations.DonatePay.APIKey != "" {
		dpWatcher := bot.NewDonatePayWatcher(cfg.Donations.DonatePay.APIKey, handleDonation)
		go dpWatcher.Run(gameCtx)
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
		go bitsWatcher.Run(gameCtx)
		log.Println("twitch bits watcher started")
	}

	var chat *bot.TwitchIRC
	chat = bot.NewTwitchIRC(cfg.Twitch.Channel, cfg.Twitch.Nick, cfg.Twitch.Token, func(cmd bot.ChatCommand) {
		switch cmd.Kind {
		case bot.CommandSue:
			recall.AddSueCall(cmd.Author)
			engine.AddChatComment(cmd.Author, "!sue")
			if sueTracker.Hit(time.Now()) {
				if chargeTrial(court.PointsSueSpam, cfg.Game.StreamerName, "Массовое требование чата", "Чат собрал "+strconv.Itoa(cfg.Courtroom.SueThreshold)+" !sue") {
					chat.SendMessage("Суд открыт по требованию чата. Присяжные, готовьтесь.")
				}
			}
		case bot.CommandGuilty:
			engine.CastVote("twitch:"+cmd.Author, true)
		case bot.CommandInnocent:
			engine.CastVote("twitch:"+cmd.Author, false)
		case bot.CommandCrime:
			if cmd.Argument != "" {
				engine.AddChatComment(cmd.Author, "!crime "+cmd.Argument)
			}
		default:
			engine.AddChatComment(cmd.Author, cmd.Argument)
		}
	})
	go chat.Run(gameCtx)
	if cfg.Twitch.Token != "" && cfg.Twitch.Channel != "" {
		log.Printf("twitch chat on #%s as %s", cfg.Twitch.Channel, cfg.Twitch.Nick)
	}

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

	engine.SetPunishments(cfg.Courtroom.Punishments)

	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)
	server := &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}

	go func() {
		log.Printf("Stream Tribunal MVP server running at http://%s", addr)
		log.Printf("Overlay disabled for now, control desk at http://%s", addr)
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

func checkHTTPAuth(cfg *config.Config, r *http.Request) bool {
	if cfg.Server.Secret == "" {
		return true
	}
	if r.Header.Get("X-Tribunal-Secret") == cfg.Server.Secret {
		return true
	}
	return r.URL.Query().Get("secret") != "" && r.URL.Query().Get("secret") == cfg.Server.Secret
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
