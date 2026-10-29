package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"stream-tribunal/web"
	"strings"
	"testing"

	"stream-tribunal/internal/config"
	"stream-tribunal/internal/obs"
)

func TestAppearanceUpdatesRequireAuthAndPreserveOtherSettings(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Server.Secret = "operator-only"
	cfg.AI.APIKey = "private-model-key"
	mux := http.NewServeMux()
	registerAppearance(mux, func() *config.Config { return cfg }, func(_ http.ResponseWriter, next *config.Config) bool { cfg = next; return true }, obs.NewHub(nil))
	request := func(method, body string, authorized bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/api/appearance", strings.NewReader(body))
		if authorized {
			req.Header.Set("X-Tribunal-Secret", "operator-only")
		}
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, req)
		return response
	}
	response := request(http.MethodGet, "", false)
	if response.Code != 200 || strings.Contains(response.Body.String(), "private-model-key") || strings.Contains(response.Body.String(), "operator-only") {
		t.Fatal("appearance should be public without exposing secrets")
	}
	if request(http.MethodPut, `{"theme":"walnut"}`, false).Code != 401 {
		t.Fatal("unauthorized update accepted")
	}
	response = request(http.MethodPut, `{"theme":"walnut","judge_preset":"magistrate","show_judge":false,"reduce_motion":true}`, true)
	if response.Code != 200 {
		t.Fatal(response.Code, response.Body.String())
	}
	var saved appearanceSettings
	if err := json.Unmarshal(response.Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	if saved.Theme != "walnut" || saved.JudgePreset != "magistrate" || saved.ShowJudge || !saved.ReduceMotion || cfg.AI.APIKey != "private-model-key" {
		t.Fatal("appearance patch lost settings")
	}
	for _, body := range []string{`{"theme":"unknown"}`, `{"judge_preset":"../../config.yaml"}`, `{"theme":"slate","judge_preset":"unknown"}`} {
		before := cfg
		if request(http.MethodPut, body, true).Code != 400 || cfg != before {
			t.Fatal("invalid appearance published", body)
		}
	}
}

func TestAppearanceFailureDoesNotPublishOrLoseDefaults(t *testing.T) {
	cfg := config.DefaultConfig()
	if !cfg.Appearance.ShowJudge || cfg.Appearance.Theme != "walnut" {
		t.Fatal("missing defaults")
	}
	mux := http.NewServeMux()
	registerAppearance(mux, func() *config.Config { return cfg }, func(w http.ResponseWriter, _ *config.Config) bool {
		http.Error(w, "disk unavailable", 500)
		return false
	}, obs.NewHub(nil))
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodPut, "/api/appearance", strings.NewReader(`{"theme":"slate"}`)))
	if response.Code != 500 || cfg.Appearance.Theme != "walnut" {
		t.Fatal("failed save changed appearance")
	}
}

func TestBundledJudgePresetsAreServedWithoutCustomPhoto(t *testing.T) {
	for _, preset := range []string{"original", "magistrate"} {
		t.Run(preset, func(t *testing.T) {
			response := httptest.NewRecorder()
			serveJudgePhoto(response, httptest.NewRequest(http.MethodGet, "/api/judge/photo?preset="+preset, nil), "custom")
			if response.Code != 200 || response.Header().Get("Content-Type") != "image/png" || response.Body.Len() == 0 {
				t.Fatal("missing bundled portrait", response.Code)
			}
		})
	}
}

func TestOriginalJudgeDoesNotReadCustomUpload(t *testing.T) {
	previous, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	folder := t.TempDir()
	if err := os.Mkdir(filepath.Join(folder, "data"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(folder, "data", "judge.png"), []byte("custom portrait"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(folder); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := os.Chdir(previous); err != nil {
			t.Error(err)
		}
	}()
	cfg := config.DefaultConfig()
	if appearanceView(cfg).JudgePreset != "custom" {
		t.Fatal("existing portrait was not preserved")
	}
	original, err := web.StaticFS.ReadFile("overlay/assets/judge.png")
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	serveJudgePhoto(response, httptest.NewRequest(http.MethodGet, "/api/judge/photo?preset=original", nil), "custom")
	if !bytes.Equal(response.Body.Bytes(), original) {
		t.Fatal("original selection returned the custom upload")
	}
	response = httptest.NewRecorder()
	serveJudgePhoto(response, httptest.NewRequest(http.MethodGet, "/api/judge/photo", nil), "")
	if response.Body.String() != "custom portrait" {
		t.Fatal("legacy custom portrait stopped loading")
	}
}
