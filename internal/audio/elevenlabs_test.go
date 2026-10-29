package audio

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestElevenLabsRequestAndErrorPrivacy(t *testing.T) {
	for _, status := range []int{200, 401, 429} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "POST" || r.URL.Path != "/v1/text-to-speech/voice-id" || r.URL.Query().Get("output_format") != "mp3_44100_128" || r.Header.Get("xi-api-key") != "private-test-key" {
					t.Error("wrong speech endpoint or credentials")
				}
				var body map[string]any
				if json.NewDecoder(r.Body).Decode(&body) != nil || body["text"] != "Суд слушает." || body["model_id"] != "eleven_multilingual_v2" {
					t.Error("wrong synthesis body")
				}
				w.WriteHeader(status)
				if status == 200 {
					_, _ = w.Write([]byte(strings.Repeat("audio", 25)))
				} else {
					_, _ = w.Write([]byte("private-test-key provider detail"))
				}
			}))
			defer server.Close()
			voice := NewElevenLabs("private-test-key", "voice-id", "", "natural")
			voice.endpoint = server.URL
			clip, err := voice.Synthesize(context.Background(), "Суд слушает.")
			if status == 200 && (err != nil || len(clip) != 125) {
				t.Fatal("speech did not reach caller", err)
			}
			if status != 200 && (err == nil || strings.Contains(err.Error(), "private-test-key")) {
				t.Fatal("upstream error leaked credentials or passed as audio")
			}
		})
	}
}

func TestElevenLabsRequiresCredentials(t *testing.T) {
	_, err := NewElevenLabs("", "", "", "natural").Synthesize(context.Background(), "hello")
	if err == nil {
		t.Fatal("missing credentials accepted")
	}
}

func TestExpressiveV3UsesSupportedSettingsAndKeepsTagsOutOfSource(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Text     string         `json:"text"`
			Settings map[string]any `json:"voice_settings"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Text != "[curious] Суд слушает." || body.Settings["stability"] != float64(0) || len(body.Settings) != 1 {
			t.Error("wrong v3 delivery settings")
		}
		_, _ = w.Write([]byte(strings.Repeat("audio", 25)))
	}))
	defer server.Close()
	voice := NewElevenLabs("key", "voice", "eleven_v3", "expressive")
	voice.endpoint = server.URL
	text := "Суд слушает."
	if _, err := voice.Synthesize(context.Background(), text); err != nil {
		t.Fatal(err)
	}
	if text != "Суд слушает." {
		t.Fatal("source text was changed")
	}
}
