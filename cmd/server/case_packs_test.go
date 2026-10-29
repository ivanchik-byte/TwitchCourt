package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"stream-tribunal/internal/config"
	"stream-tribunal/internal/court"
	"stream-tribunal/internal/obs"
	"stream-tribunal/internal/safety"
)

func TestCasePackHTTPContract(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Server.Secret = "operator"
	engine := court.NewEngine(cfg, obs.NewHub(nil), nil, nil, safety.NewFilter(nil))
	path := filepath.Join(t.TempDir(), "cases.yaml")
	if err := os.WriteFile(path, []byte("cases: []\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := engine.LoadCases(path); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	registerCasePacks(mux, func() *config.Config { return cfg }, engine)
	registerShowControls(mux, func() *config.Config { return cfg }, engine)
	request := func(method, path, body string, auth bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		if auth {
			r.Header.Set("X-Tribunal-Secret", "operator")
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}
	if request("POST", "/api/cases/packs", `{"id":"after-hours"}`, false).Code != 401 {
		t.Fatal("pack import needs authorization")
	}
	if request("GET", "/api/cases/packs", "", true).Code != 200 {
		t.Fatal("pack listing unavailable")
	}
	for _, expected := range []int{6, 0} {
		w := request("POST", "/api/cases/packs", `{"id":"after-hours"}`, true)
		if w.Code != 200 || !strings.Contains(w.Body.String(), fmt.Sprintf(`"added":%d`, expected)) {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	if request("POST", "/api/cases/packs", `{"id":"unknown"}`, true).Code != 404 {
		t.Fatal("unknown pack accepted")
	}
	if request("POST", "/api/trial/exhibit", `{"trial_id":1,"index":0}`, false).Code != 401 {
		t.Fatal("exhibit needs authorization")
	}
	if request("POST", "/api/trial/exhibit", `{"index":0}`, true).Code != 400 {
		t.Fatal("unbound exhibit accepted")
	}
	if request("POST", "/api/trial/exhibit", `{"trial_id":1,"index":0}`, true).Code != 409 {
		t.Fatal("idle trial accepted evidence")
	}
	if engine.CaseDeck().Remaining() != 6 {
		t.Fatal("failed exhibit request consumed a card")
	}
}
