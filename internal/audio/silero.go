package audio

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// SileroSynthesizer connects to local Python Silero sidecar over HTTP.
type SileroSynthesizer struct {
	mu    sync.RWMutex
	url   string
	voice string
	http  *http.Client
}

func NewSileroSynthesizer(url, voice string) *SileroSynthesizer {
	if url == "" {
		url = "http://127.0.0.1:7892"
	}
	if voice == "" {
		voice = "kseniya"
	}
	return &SileroSynthesizer{
		url:   strings.TrimRight(url, "/"),
		voice: voice,
		http:  &http.Client{Timeout: 30 * time.Second},
	}
}

// SetVoiceProfile updates Silero speaker name.
func (s *SileroSynthesizer) SetVoiceProfile(voice, _ string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if voice != "" {
		s.voice = voice
	}
}

func (s *SileroSynthesizer) Synthesize(ctx context.Context, text string) ([]byte, error) {
	s.mu.RLock()
	voice := s.voice
	s.mu.RUnlock()

	body, err := json.Marshal(map[string]string{"text": text, "speaker": voice})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.url+"/synthesize", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("silero sidecar status %d", resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8*1024*1024))
	if err != nil {
		return nil, err
	}
	if len(raw) < 100 {
		return nil, fmt.Errorf("silero sidecar returned %d bytes", len(raw))
	}
	return raw, nil
}

func (s *SileroSynthesizer) Close() error { return nil }
