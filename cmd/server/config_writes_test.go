package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"

	"stream-tribunal/internal/config"
)

func TestConfigWritesPreserveIndependentUpdates(t *testing.T) {
	var current atomic.Pointer[config.Config]
	current.Store(config.DefaultConfig())
	path := filepath.Join(t.TempDir(), "config.yaml")
	handler := serializeConfigWrites(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next := current.Load().Clone()
		runtime.Gosched()
		if r.URL.Path == "/judge" {
			next.Courtroom.JudgeName = r.URL.Query().Get("name")
		} else {
			next.Game.StreamerName = r.URL.Query().Get("name")
		}
		if err := next.Save(path); err != nil {
			t.Error(err)
			w.WriteHeader(500)
			return
		}
		current.Store(next)
	}))
	for round := 0; round < 20; round++ {
		name := fmt.Sprint(round)
		start := make(chan struct{})
		var workers sync.WaitGroup
		for _, endpoint := range []string{"/judge", "/streamer"} {
			workers.Add(1)
			go func(endpoint string) {
				defer workers.Done()
				<-start
				w := httptest.NewRecorder()
				handler.ServeHTTP(w, httptest.NewRequest("PUT", endpoint+"?name="+name, nil))
				if w.Code != 200 {
					t.Errorf("status %d", w.Code)
				}
			}(endpoint)
		}
		close(start)
		workers.Wait()
		disk, err := config.LoadConfig(path)
		if err != nil {
			t.Fatal(err)
		}
		live := current.Load()
		if live.Courtroom.JudgeName != name || live.Game.StreamerName != name || disk.Game.StreamerName != name || disk.Courtroom.JudgeName != name {
			t.Fatalf("round %d lost an independent update", round)
		}
	}
}
