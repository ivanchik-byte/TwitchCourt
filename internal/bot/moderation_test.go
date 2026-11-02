package bot

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestModerationWaitsForHelixConfirmation(t *testing.T) {
	for _, action := range []string{"ban", "timeout", "pardon"} {
		t.Run(action, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.Header.Get("Authorization") != "Bearer token" || r.Header.Get("Client-Id") != "client" {
					t.Error("wrong credentials")
				}
				if r.URL.Path == "/users" {
					if r.URL.Query().Get("login") != "viewer" {
						t.Error("wrong lookup")
					}
					w.Write([]byte(`{"data":[{"id":"123"}]}`))
					return
				}
				if r.URL.Path != "/moderation/bans" || r.URL.Query().Get("broadcaster_id") != "broad" || r.URL.Query().Get("moderator_id") != "mod" {
					t.Error("wrong moderation target")
				}
				if action == "pardon" {
					if r.Method != "DELETE" || r.URL.Query().Get("user_id") != "123" {
						t.Error("wrong unban")
					}
					w.WriteHeader(204)
					return
				}
				var body struct {
					Data map[string]any `json:"data"`
				}
				json.NewDecoder(r.Body).Decode(&body)
				if r.Method != "POST" || body.Data["user_id"] != "123" {
					t.Error("wrong ban request")
				}
				if action == "timeout" && body.Data["duration"] != float64(60) {
					t.Error("missing timeout duration")
				}
				if action == "ban" && body.Data["duration"] != nil {
					t.Error("permanent ban has duration")
				}
				w.Write([]byte(`{"data":[{"user_id":"123"}]}`))
			}))
			defer server.Close()
			client := NewUnbanClient("oauth:token", "client", "broad", "mod")
			client.apiBase = server.URL
			if err := client.Moderate(context.Background(), "viewer", action, 60, "Reason"); err != nil {
				t.Fatal(err)
			}
			if calls != 2 {
				t.Fatalf("got %d requests", calls)
			}
		})
	}
}

func TestModerationRejectsMissingConfigAndServiceRefusals(t *testing.T) {
	if err := NewUnbanClient("", "", "", "").Moderate(context.Background(), "viewer", "ban", 0, ""); !errors.Is(err, ErrModerationNotConfigured) {
		t.Fatal(err)
	}
	for _, status := range []int{401, 403, 429, 500} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/users" {
					w.Write([]byte(`{"data":[{"id":"123"}]}`))
					return
				}
				w.WriteHeader(status)
				w.Write([]byte(`{"message":"do not leak this provider body"}`))
			}))
			defer server.Close()
			client := NewUnbanClient("token", "client", "broad", "")
			client.apiBase = server.URL
			if err := client.Moderate(context.Background(), "viewer", "ban", 0, ""); err == nil {
				t.Fatal("service refusal reported as success")
			}
		})
	}
}
