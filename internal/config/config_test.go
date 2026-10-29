package config

import (
	"testing"
)

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()
	if cfg.Server.Port != 3236 {
		t.Errorf("expected default port 3236, got %d", cfg.Server.Port)
	}
	if cfg.Courtroom.Theme != "ace_attorney" {
		t.Errorf("expected ace_attorney theme, got %s", cfg.Courtroom.Theme)
	}
	if !cfg.Safety.FilterEnabled {
		t.Error("expected safety filter to be enabled by default")
	}
}
