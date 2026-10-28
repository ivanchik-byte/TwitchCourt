package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"stream-tribunal/internal/ai"
	"stream-tribunal/internal/audio"
	"stream-tribunal/internal/config"
	"stream-tribunal/internal/court"
	"stream-tribunal/internal/obs"
	"stream-tribunal/internal/safety"
)

func TestFailedTrialPreservesQueueAndDeck(t *testing.T) {
	cfg := config.DefaultConfig()
	engine := court.NewEngine(cfg, obs.NewHub(nil), nil, nil, safety.NewFilter(nil))
	path := filepath.Join(t.TempDir(), "cases.yaml")
	if err := os.WriteFile(path, []byte("cases:\n  - id: one\n    title: Test\n    crime: Charge\n    weight: 3\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := engine.LoadCases(path); err != nil {
		t.Fatal(err)
	}
	deck := engine.CaseDeck()
	engine.JoinPool("viewer", "")
	invoke := func() int {
		response := httptest.NewRecorder()
		trialHandler(func() *config.Config { return cfg }, engine)(response, httptest.NewRequest(http.MethodPost, "/api/trial", strings.NewReader(`{"defendant":"viewer","viewer":true,"case_id":"one"}`)))
		return response.Code
	}
	if status := invoke(); status != 412 {
		t.Fatal(status)
	}
	if deck.Remaining() != 1 || len(engine.PoolList()) != 1 {
		t.Fatal("failed start consumed participant or case")
	}
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"choices":[{"message":{"content":"Суд слушает."}}]}`)
	}))
	defer model.Close()
	cfg.AI.BaseURL, cfg.AI.Stream = model.URL, false
	client, err := ai.NewClient(cfg.AI)
	if err != nil {
		t.Fatal(err)
	}
	engine.SetAI(client)
	voice, _ := audio.NewPiperDaemon(cfg.TTS)
	defer voice.Close()
	defer engine.TriggerPanic()
	engine.SetVoice(voice)
	if status := invoke(); status != 202 {
		t.Fatal(status)
	}
	if deck.Remaining() != 0 || len(engine.PoolList()) != 0 {
		t.Fatal("successful start did not consume participant and case")
	}
}
