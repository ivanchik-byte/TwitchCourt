package config

import (
	"fmt"
	"path/filepath"
	"sync"
	"testing"
)

func TestConcurrentSavesUseSeparateTemporaryFiles(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	start := make(chan struct{})
	var workers sync.WaitGroup
	for i := 0; i < 20; i++ {
		workers.Add(1)
		go func(i int) {
			defer workers.Done()
			cfg := DefaultConfig()
			cfg.Courtroom.JudgeName = fmt.Sprintf("judge-%d", i)
			<-start
			if err := cfg.Save(path); err != nil {
				t.Errorf("save %d: %v", i, err)
			}
		}(i)
	}
	close(start)
	workers.Wait()
	if _, err := LoadConfig(path); err != nil {
		t.Fatal(err)
	}
}
