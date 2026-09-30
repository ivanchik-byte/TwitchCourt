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
	"syscall"
	"time"

	"stream-tribunal/internal/ai"
	"stream-tribunal/internal/audio"
	"stream-tribunal/internal/config"
	"stream-tribunal/internal/court"
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

	piper, err := audio.NewPiperDaemon(cfg.TTS)
	if err != nil {
		log.Fatalf("failed to initialize piper tts: %v", err)
	}
	defer piper.Close()

	aiClient := ai.NewClient(cfg.AI)

	var engine *court.Engine

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
			}
			if err := json.Unmarshal(payload, &req); err == nil {
				if err := engine.StartTrial(req.Defendant, req.Crime, req.Context); err != nil {
					log.Printf("start trial rejected: %v", err)
				}
			}
		case "panic":
			engine.TriggerPanic()
		case "vote":
			var voteReq struct {
				Voter    string `json:"voter"`
				IsGuilty bool   `json:"is_guilty"`
			}
			if err := json.Unmarshal(payload, &voteReq); err == nil {
				engine.CastVote(voteReq.Voter, voteReq.IsGuilty)
			}
		}
	})

	go hub.Run()

	engine = court.NewEngine(cfg, hub, aiClient, piper, filter)

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
