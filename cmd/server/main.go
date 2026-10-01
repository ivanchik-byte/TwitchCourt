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

	hub := obs.NewHub(func(action string, payload []byte) {
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
				} else {
					sueTracker.MarkTrial(time.Now())
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
		}
	})

	go hub.Run()

	engine = court.NewEngine(cfg, hub, aiClient, voice, filter)
	engine.AttachMemory(recall)

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
	mux.Handle("/", dashboardHandler)

	mux.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "online",
			"state":  engine.GetState(),
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
		sueTracker.MarkTrial(time.Now())
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

	gameCtx, stopGame := context.WithCancel(context.Background())
	defer stopGame()
	if cfg.Game.MinecraftLog != "" {
		watcher := game.NewWatcher(cfg.Game.MinecraftLog, func(d game.Death) {
			if err := engine.StartTrial(cfg.Game.StreamerName, d.Crime, d.Context); err == nil {
				sueTracker.MarkTrial(time.Now())
			}
		})
		go watcher.Run(gameCtx)
		log.Printf("minecraft watcher on %s", cfg.Game.MinecraftLog)
	}

	donateWatcher := bot.NewDonationsWatcher(cfg.Game.DonateToken, func(d bot.Donation) {
		recall.AddDonation(memory.DonationRecord{Donor: d.Donor, Amount: d.Amount, Message: d.Message})
		if d.Amount >= 500 && d.Donor != "" {
			recall.NoteForAI("меценат " + d.Donor + " любит взятки и ждет снисхождения")
		}
	})
	go donateWatcher.Run(gameCtx)

	var chat *bot.TwitchIRC
	chat = bot.NewTwitchIRC(cfg.Twitch.Channel, cfg.Twitch.Nick, cfg.Twitch.Token, func(cmd bot.ChatCommand) {
		switch cmd.Kind {
		case bot.CommandSue:
			recall.AddSueCall(cmd.Author)
			engine.AddChatComment(cmd.Author, "!sue")
			if sueTracker.Hit(time.Now()) {
				if err := engine.StartTrial(cfg.Game.StreamerName, "Массовое требование чата", "Чат собрал "+strconv.Itoa(cfg.Courtroom.SueThreshold)+" !sue"); err == nil {
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

	engine.VerdictHook = func(verdict string, guilty, innocent int) {
		chat.SendMessage("Вердикт суда: " + verdict + " (" + strconv.Itoa(guilty) + "-" + strconv.Itoa(innocent) + ")")
	}

	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)
	server := &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}

	go func() {
		log.Printf("Stream Tribunal MVP server running at http://%s", addr)
		log.Printf("OBS Browser Source URL: http://%s/overlay", addr)
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
