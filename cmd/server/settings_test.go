package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"stream-tribunal/internal/bot"
	"stream-tribunal/internal/config"
	"stream-tribunal/internal/court"
	"stream-tribunal/internal/obs"
	"stream-tribunal/internal/safety"
)

func TestShowRulesAreValidatedAndPatched(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.AI.APIKey = "keep-this-key"
	engine := court.NewEngine(cfg, obs.NewHub(nil), nil, nil, safety.NewFilter(nil))
	mux := http.NewServeMux()
	registerSettings(mux, func() *config.Config { return cfg }, func(_ http.ResponseWriter, next *config.Config) bool {
		cfg = next
		engine.SwapConfig(next)
		return true
	}, engine, bot.NewGate(cfg.Donations.MinAmounts, cfg.Donations.DefaultMin))
	request := httptest.NewRequest(http.MethodPut, "/api/settings", strings.NewReader(`{"bribe_min":250,"bribe_words":[" взятк "," "],"queue_min":100,"queue_open":false,"rule_currency":"EUR","witness_enabled":false}`))
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != 200 {
		t.Fatal(response.Code, response.Body.String())
	}
	if cfg.Donations.BribeMin != 250 || cfg.Donations.QueueMin != 100 || cfg.Donations.RuleCurrency != "EUR" || cfg.Donations.WitnessEnabled || cfg.Courtroom.QueueOpen || len(cfg.Safety.BribeWords) != 1 {
		t.Fatal("rules not saved")
	}
	if cfg.AI.APIKey != "keep-this-key" || cfg.Donations.MinAmounts["USD"] != 2 {
		t.Fatal("unrelated settings were replaced")
	}
	for _, body := range []string{`{"bribe_min":-1}`, `{"min_amounts":{"RUB":-1}}`, `{"rule_currency":"NOPE"}`, `{"cases_gen_batch":0}`} {
		before := cfg
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest(http.MethodPut, "/api/settings", strings.NewReader(body)))
		if response.Code != 400 || cfg != before {
			t.Fatalf("invalid settings were published: %s %d", body, response.Code)
		}
	}
}
