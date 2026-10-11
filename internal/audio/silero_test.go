package audio

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func wavFixture() []byte {
	buf := make([]byte, 44+320)
	copy(buf, []byte("RIFF"))
	binary.LittleEndian.PutUint32(buf[4:], 312)
	copy(buf[8:], []byte("WAVE"))
	return buf
}

func TestSileroDefaultVoice(t *testing.T) {
	s := NewSileroSynthesizer("http://127.0.0.1:9", "")
	var gotSpeaker string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Speaker string `json:"speaker"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		gotSpeaker = req.Speaker
		w.Header().Set("Content-Type", "audio/wav")
		w.Write(wavFixture())
	}))
	defer server.Close()
	s = NewSileroSynthesizer(server.URL, "")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := s.Synthesize(ctx, "тест"); err != nil {
		t.Fatal(err)
	}
	if gotSpeaker != "kseniya" {
		t.Fatalf("default silero voice must be kseniya, got %q", gotSpeaker)
	}
}

func TestSileroRoundtrip(t *testing.T) {
	var gotSpeaker, gotText string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/synthesize" {
			t.Errorf("bad path %s", r.URL.Path)
		}
		var req struct {
			Text    string `json:"text"`
			Speaker string `json:"speaker"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Errorf("bad body: %v", err)
		}
		gotSpeaker, gotText = req.Speaker, req.Text
		w.Header().Set("Content-Type", "audio/wav")
		w.Write(wavFixture())
	}))
	defer server.Close()

	s := NewSileroSynthesizer(server.URL, "aidar")
	s.SetVoiceProfile("baya", "+0%")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	raw, err := s.Synthesize(ctx, "Суд слушает.")
	if err != nil {
		t.Fatalf("synthesize failed: %v", err)
	}
	if len(raw) != 364 {
		t.Fatalf("want fixture bytes, got %d", len(raw))
	}
	if gotSpeaker != "baya" || gotText != "Суд слушает." {
		t.Fatalf("bad request fields: %q %q", gotSpeaker, gotText)
	}
}

func TestSileroErrorPaths(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	s := NewSileroSynthesizer(server.URL, "aidar")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := s.Synthesize(ctx, "x"); err == nil {
		t.Fatal("want error on 500")
	}

	dead := NewSileroSynthesizer("http://127.0.0.1:1", "aidar")
	if _, err := dead.Synthesize(ctx, "x"); err == nil {
		t.Fatal("want error on refused connection")
	}
}
