package bot

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

func TestUnbanFetchPending(t *testing.T) {
	var gotQuery url.Values
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/moderation/unban_requests" {
			t.Errorf("bad path %s", r.URL.Path)
		}
		if r.Header.Get("Client-Id") == "" || r.Header.Get("Authorization") == "" {
			t.Error("missing helix auth headers")
		}
		gotQuery = r.URL.Query()
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"data":[{"id":"req1","user_id":"u1","user_login":"troll","user_name":"Troll","text":"кот по клаве прошёлся","created_at":"2026-10-02T10:00:00Z"}]}`))
	}))
	defer server.Close()

	c := NewUnbanClient("tok", "cid", "broad", "")
	c.apiBase = server.URL
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	items, err := c.FetchPending(ctx)
	if err != nil {
		t.Fatalf("fetch failed: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("want 1 request, got %d", len(items))
	}
	got := items[0]
	if got.ID != "req1" || got.UserLogin != "troll" || got.Text != "кот по клаве прошёлся" {
		t.Fatalf("bad fields: %+v", got)
	}
	if gotQuery.Get("status") != "pending" || gotQuery.Get("broadcaster_id") != "broad" {
		t.Fatalf("bad query: %v", gotQuery)
	}
	if gotQuery.Get("moderator_id") != "broad" {
		t.Fatalf("moderator must default to broadcaster: %v", gotQuery)
	}
}

func TestUnbanResolve(t *testing.T) {
	var gotQuery url.Values
	var gotMethod string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotQuery = r.Method, r.URL.Query()
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"data":[]}`))
	}))
	defer server.Close()

	c := NewUnbanClient("tok", "cid", "broad", "mod")
	c.apiBase = server.URL
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := c.Resolve(ctx, "req1", true, ""); err != nil {
		t.Fatalf("resolve failed: %v", err)
	}
	if gotMethod != http.MethodPatch {
		t.Fatalf("want PATCH, got %s", gotMethod)
	}
	if gotQuery.Get("unban_request_id") != "req1" || gotQuery.Get("status") != "approved" {
		t.Fatalf("bad query: %v", gotQuery)
	}
	if err := c.Resolve(ctx, "", true, ""); err == nil {
		t.Fatal("empty id must fail")
	}
}

func TestUnbanNotConfigured(t *testing.T) {
	c := NewUnbanClient("", "", "", "")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := c.FetchPending(ctx); err == nil {
		t.Fatal("unconfigured client must fail fast")
	}
}
