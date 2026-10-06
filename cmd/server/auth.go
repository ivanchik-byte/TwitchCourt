package main

import (
	"net/http"

	"stream-tribunal/internal/config"
)

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
	return r.Header.Get("X-Tribunal-Secret") == cfg.Server.Secret
}
