package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"stream-tribunal/internal/bot"
	"stream-tribunal/internal/config"
)

func TestCheckAuth(t *testing.T) {
	cfgNoSecret := &config.Config{}
	if !checkSecret(cfgNoSecret, "anything") {
		t.Fatal("empty secret in config should allow any secret")
	}
	req, _ := http.NewRequest(http.MethodGet, "/", nil)
	if !checkHTTPAuth(cfgNoSecret, req) {
		t.Fatal("empty secret in config should allow request without header")
	}

	cfgWithSecret := &config.Config{
		Server: config.ServerConfig{Secret: "tribunal-pass-42"},
	}
	if !checkSecret(cfgWithSecret, "tribunal-pass-42") {
		t.Fatal("exact secret should match")
	}
	if checkSecret(cfgWithSecret, "wrong-pass") {
		t.Fatal("wrong secret must be rejected")
	}
	if checkSecret(cfgWithSecret, "") {
		t.Fatal("empty secret must be rejected when secret is configured")
	}

	reqValid, _ := http.NewRequest(http.MethodGet, "/", nil)
	reqValid.Header.Set("X-Tribunal-Secret", "tribunal-pass-42")
	if !checkHTTPAuth(cfgWithSecret, reqValid) {
		t.Fatal("request with matching header should pass")
	}

	reqInvalid, _ := http.NewRequest(http.MethodGet, "/", nil)
	reqInvalid.Header.Set("X-Tribunal-Secret", "bad")
	if checkHTTPAuth(cfgWithSecret, reqInvalid) {
		t.Fatal("request with invalid header must be rejected")
	}
}

func TestActionLimiter(t *testing.T) {
	limiter := newActionLimiter(50 * time.Millisecond)

	if !limiter.allow("user1") {
		t.Fatal("first call for user1 should be allowed")
	}
	if limiter.allow("user1") {
		t.Fatal("immediate second call for user1 should be rate limited")
	}

	if !limiter.allow("user2") {
		t.Fatal("call for different key user2 should be allowed")
	}

	time.Sleep(60 * time.Millisecond)
	if !limiter.allow("user1") {
		t.Fatal("call after interval elapsed should be allowed")
	}
}

func TestActionLimiterPruning(t *testing.T) {
	limiter := newActionLimiter(time.Millisecond)

	// Populate map beyond 4096 entries
	for i := 0; i < 4100; i++ {
		key := string(rune('a' + (i % 26))) + string(rune(i))
		limiter.last[key] = time.Now().Add(-time.Hour)
	}

	if !limiter.allow("fresh-key") {
		t.Fatal("allow should succeed and trigger map pruning")
	}

	limiter.mu.Lock()
	size := len(limiter.last)
	limiter.mu.Unlock()

	if size > 4096 {
		t.Fatalf("map size after pruning should be <= 4096, got %d", size)
	}
}

func TestTruncateRunes(t *testing.T) {
	cases := []struct {
		input    string
		max      int
		expected string
	}{
		{"hello", 10, "hello"},
		{"hello", 3, "hel"},
		{"Привет, суд!", 6, "Привет"},
		{"🔥⚡🎉", 2, "🔥⚡"},
		{"", 5, ""},
	}

	for _, tc := range cases {
		got := truncateRunes(tc.input, tc.max)
		if got != tc.expected {
			t.Errorf("truncateRunes(%q, %d) = %q, want %q", tc.input, tc.max, got, tc.expected)
		}
	}
}

func TestDecodeJSON(t *testing.T) {
	type payload struct {
		Name string `json:"name"`
		Age  int    `json:"age"`
	}

	// Valid payload
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"name":"alice","age":30}`))
	var val payload
	if err := decodeJSON(w, req, &val); err != nil {
		t.Fatalf("decodeJSON valid payload failed: %v", err)
	}
	if val.Name != "alice" || val.Age != 30 {
		t.Fatalf("decodeJSON parsed unexpected value: %+v", val)
	}

	// Disallowed unknown fields
	reqExtra := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"name":"alice","unknown":true}`))
	if err := decodeJSON(w, reqExtra, &val); err == nil {
		t.Fatal("decodeJSON must fail on unknown fields")
	}

	// Oversized body (> 64KB)
	largeBody := bytes.Repeat([]byte("a"), 70*1024)
	reqLarge := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(largeBody))
	if err := decodeJSON(w, reqLarge, &val); err == nil {
		t.Fatal("decodeJSON must fail on bodies > 64KB")
	}
}

func TestSPAHandler(t *testing.T) {
	mockFS := fstest.MapFS{
		"index.html":       {Data: []byte("<html>Court Dashboard</html>")},
		"assets/style.css": {Data: []byte("body { background: black; }")},
	}

	handler := spaHandler(mockFS)

	// Direct asset request
	reqAsset := httptest.NewRequest(http.MethodGet, "/assets/style.css", nil)
	recAsset := httptest.NewRecorder()
	handler.ServeHTTP(recAsset, reqAsset)
	if recAsset.Code != http.StatusOK {
		t.Fatalf("expected 200 for existing asset, got %d", recAsset.Code)
	}
	if !strings.Contains(recAsset.Body.String(), "background: black") {
		t.Fatalf("unexpected asset body: %s", recAsset.Body.String())
	}

	// SPA route fallback to index.html
	reqSPA := httptest.NewRequest(http.MethodGet, "/cockpit/bench", nil)
	recSPA := httptest.NewRecorder()
	handler.ServeHTTP(recSPA, reqSPA)
	if recSPA.Code != http.StatusOK {
		t.Fatalf("expected 200 for SPA route, got %d", recSPA.Code)
	}
	if !strings.Contains(recSPA.Body.String(), "Court Dashboard") {
		t.Fatalf("expected index.html fallback, got %s", recSPA.Body.String())
	}

	// API and WS paths must 404
	for _, p := range []string{"/api/court/state", "/ws/feed"} {
		req404 := httptest.NewRequest(http.MethodGet, p, nil)
		rec404 := httptest.NewRecorder()
		handler.ServeHTTP(rec404, req404)
		if rec404.Code != http.StatusNotFound {
			t.Fatalf("expected 404 for %s, got %d", p, rec404.Code)
		}
	}
}

func TestDonationLogic(t *testing.T) {
	bribeCfg := &config.Config{}
	bribeCfg.Safety.BribeWords = []string{"взятк"}
	bribeCfg.Donations.BribeMin = 500
	if !isBribe(bribeCfg, 10, "это вам на взятку, ваша честь") {
		t.Fatal("isBribe should match 'взятку'")
	}
	if !isBribe(bribeCfg, 10, "ВЗЯТКА судье") {
		t.Fatal("isBribe should match uppercase 'ВЗЯТКА'")
	}
	if isBribe(bribeCfg, 10, "просто поддержать стрим") {
		t.Fatal("isBribe should not match regular donation")
	}
	if !isBribe(bribeCfg, 1000, "просто поддержать стрим") {
		t.Fatal("big money without a hint must count as worth noticing")
	}
	if isBribe(&config.Config{}, 1000000, "просто поддержать стрим") {
		t.Fatal("empty bribe words and no minimum must disable bribes")
	}

	cfg := &config.Config{
		Donations: config.DonationsConfig{
			StreamerTrialMin: 500,
			PlatinumMin:      1000,
		},
		Game: config.GameConfig{
			StreamerName: "IvanStreamer",
		},
		Chat: config.ChatConfig{
			DonateCrime: "Донат: {message}",
		},
	}

	var calledDefendant, calledCrime, calledContext string
	openMock := func(defendant, crime, context string) bool {
		calledDefendant = defendant
		calledCrime = crime
		calledContext = context
		return true
	}

	// Streamer trial trigger
	openDonationTrial(cfg, openMock, "GenerousViewer", 600, "RUB", "За плохой геймплей")
	if calledDefendant != "IvanStreamer" {
		t.Fatalf("expected defendant IvanStreamer, got %s", calledDefendant)
	}
	if calledCrime != "Донат: За плохой геймплей" {
		t.Fatalf("unexpected crime: %s", calledCrime)
	}
	if !strings.Contains(calledContext, "GenerousViewer") {
		t.Fatalf("unexpected context: %s", calledContext)
	}

	// Below threshold
	calledDefendant = ""
	openDonationTrial(cfg, openMock, "BrokeViewer", 100, "RUB", "Привет")
	if calledDefendant != "" {
		t.Fatalf("below min threshold should not trigger trial, got defendant: %s", calledDefendant)
	}
}

func TestUnbanBoard(t *testing.T) {
	b := newUnbanBoard()
	if len(b.list()) != 0 {
		t.Fatal("new board should be empty")
	}

	b.mu.Lock()
	b.items = []bot.UnbanRequest{
		{ID: "req-1", UserLogin: "troublemaker", Text: "please unban"},
	}
	b.mu.Unlock()

	items := b.list()
	if len(items) != 1 || items[0].UserLogin != "troublemaker" {
		t.Fatalf("unexpected items: %+v", items)
	}

	// Ensure list() returns a copy preventing data races/mutations
	items[0].UserLogin = "tampered"
	if b.list()[0].UserLogin != "troublemaker" {
		t.Fatal("list() must return a safe copy")
	}
}

