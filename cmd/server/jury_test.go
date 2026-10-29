package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"stream-tribunal/internal/config"
	"stream-tribunal/internal/court"
	"stream-tribunal/internal/obs"
	"stream-tribunal/internal/safety"
)

func TestJuryHTTPBoundRehearsalAndAuthentication(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Server.Secret = "operator"
	engine := court.NewEngine(cfg, obs.NewHub(nil), nil, nil, safety.NewFilter(nil))
	mux := http.NewServeMux()
	registerJury(mux, func() *config.Config { return cfg }, engine)
	request := func(method, path, body string, authorized bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		if authorized {
			r.Header.Set("X-Tribunal-Secret", "operator")
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}
	for _, path := range []string{"/api/jury", "/api/jury/test-vote"} {
		if request("POST", path, `{}`, false).Code != 401 {
			t.Fatal("jury endpoint needs authentication", path)
		}
	}
	if request("GET", "/api/jury", "", false).Code != 401 {
		t.Fatal("jury snapshot needs authentication")
	}
	if request("POST", "/api/jury", `{}`, true).Code != 400 {
		t.Fatal("unbound mutation accepted")
	}
	if request("DELETE", "/api/jury", "", true).Code != 405 {
		t.Fatal("unsupported method accepted")
	}
	if err := engine.StartDemo("viewer"); err != nil {
		t.Fatal(err)
	}
	defer engine.TriggerPanic()
	if err := engine.AdvancePhase(court.StateIndictment); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for engine.GetState() != court.StateTestimony {
		if time.Now().After(deadline) {
			t.Fatal("rehearsal did not advance")
		}
		time.Sleep(time.Millisecond)
	}
	view := engine.JurySnapshot()
	body := fmt.Sprintf(`{"epoch":%q,"trial_id":%d,"revision":%d,"action":"open","round":1,"seconds":20}`, view.Epoch, view.TrialID, view.Revision)
	w := request("POST", "/api/jury", body, true)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var opened obs.JuryPayload
	if err := json.Unmarshal(w.Body.Bytes(), &opened); err != nil {
		t.Fatal(err)
	}
	if request("POST", "/api/jury", body, true).Code != 409 {
		t.Fatal("stale open changed ballot")
	}
	vote := fmt.Sprintf(`{"epoch":%q,"trial_id":%d,"poll_id":%q,"nick":"demo_anya","choice":"1"}`, view.Epoch, view.TrialID, opened.First.ID)
	for i := 0; i < 2; i++ {
		if request("POST", "/api/jury/test-vote", vote, true).Code != 200 {
			t.Fatal("rehearsal vote failed")
		}
	}
	w = request("GET", "/api/jury", "", true)
	if strings.Contains(w.Body.String(), `"guilty"`) || engine.JurySnapshot().First.Total != 1 {
		t.Fatal("open HTTP snapshot leaked or duplicated results", w.Body.String())
	}
	close := fmt.Sprintf(`{"epoch":%q,"trial_id":%d,"action":"close","poll_id":%q}`, view.Epoch, view.TrialID, opened.First.ID)
	if request("POST", "/api/jury", close, true).Code != 200 {
		t.Fatal("close failed")
	}
	if request("POST", "/api/jury/test-vote", vote, true).Code != 409 {
		t.Fatal("closed ballot accepted a vote")
	}
}
