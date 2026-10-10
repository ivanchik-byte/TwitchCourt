package main

import (
	"crypto/subtle"
	"net/http"

	"stream-tribunal/internal/config"
)

func checkSecret(cfg *config.Config, got string) bool {
	if cfg.Server.Secret == "" {
		return true
	}
	if got == "" {
		return false
	}
	// constant-time: don't leak the secret through timing
	return subtle.ConstantTimeCompare([]byte(got), []byte(cfg.Server.Secret)) == 1
}

func checkHTTPAuth(cfg *config.Config, r *http.Request) bool {
	if cfg.Server.Secret == "" {
		return true
	}
	got := r.Header.Get("X-Tribunal-Secret")
	if got == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(cfg.Server.Secret)) == 1
}
