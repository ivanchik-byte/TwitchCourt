package main

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"stream-tribunal/internal/config"
	"stream-tribunal/internal/court"
)

type localVoice struct {
	mu     sync.Mutex
	cmd    *exec.Cmd
	failed bool
	closed bool
}

func (s *localVoice) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	if s.cmd != nil {
		_ = s.cmd.Process.Kill()
	}
}

func registerLocalVoice(mux *http.ServeMux, current func() *config.Config, engine *court.Engine) *localVoice {
	service := &localVoice{}
	client := &http.Client{Timeout: time.Second}
	mux.HandleFunc("/api/tts/local", func(w http.ResponseWriter, r *http.Request) {
		if !checkHTTPAuth(current(), r) {
			http.Error(w, "unauthorized", 401)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodPost {
			http.Error(w, "method not allowed", 405)
			return
		}
		health := func() map[string]any {
			resp, err := client.Get("http://127.0.0.1:7892/health")
			if err != nil {
				return nil
			}
			defer resp.Body.Close()
			var state struct {
				Service string   `json:"service"`
				Status  string   `json:"status"`
				Voices  []string `json:"voices"`
			}
			if json.NewDecoder(http.MaxBytesReader(w, resp.Body, 16384)).Decode(&state) != nil || state.Service != "tribunal-silero" {
				return nil
			}
			return map[string]any{"status": state.Status, "voices": state.Voices}
		}
		if state := health(); state != nil {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(state)
			return
		}
		service.mu.Lock()
		defer service.mu.Unlock()
		if r.Method == http.MethodPost && service.cmd == nil {
			if engine.GetState() != court.StateIdle {
				http.Error(w, "Закончите заседание перед запуском голоса.", 409)
				return
			}
			if service.closed {
				http.Error(w, "Сервер останавливается.", 503)
				return
			}
			python := filepath.Join(".venv-tts", "bin", "python")
			if runtime.GOOS == "windows" {
				python = filepath.Join(".venv-tts", "Scripts", "python.exe")
			}
			if _, err := os.Stat(python); err != nil {
				http.Error(w, "Сначала подготовьте голос: выполните ./voice.sh silero в папке проекта. Инструкция находится ниже кнопки запуска.", 412)
				return
			}
			if _, err := os.Stat("tools/silero_sidecar.py"); err != nil {
				http.Error(w, "Не найден tools/silero_sidecar.py. Запустите приложение из папки проекта.", 412)
				return
			}
			if err := os.MkdirAll("data", 0755); err != nil {
				http.Error(w, "Не удалось создать папку журнала data.", 500)
				return
			}
			logFile, err := os.OpenFile(filepath.Join("data", "silero.log"), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
			if err != nil {
				http.Error(w, "Не удалось открыть data/silero.log.", 500)
				return
			}
			cmd := exec.Command(python, "-u", "tools/silero_sidecar.py")
			cmd.Stdout, cmd.Stderr = logFile, logFile
			if err := cmd.Start(); err != nil {
				logFile.Close()
				http.Error(w, "Не удалось запустить Python. Повторите подготовку голоса.", 500)
				return
			}
			service.cmd, service.failed = cmd, false
			go func() {
				err := cmd.Wait()
				logFile.Close()
				service.mu.Lock()
				service.cmd = nil
				service.failed = err != nil
				service.mu.Unlock()
			}()
		}
		state := "stopped"
		if service.failed {
			state = "error"
		}
		if service.cmd != nil {
			state = "loading"
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"status": state, "voices": []string{}})
	})
	return service
}
