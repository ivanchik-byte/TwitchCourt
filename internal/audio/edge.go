package audio

import (
	"bytes"
	"context"
	"sync"

	edge "github.com/difyz9/edge-tts-go/pkg/communicate"
)

// EdgeSynthesizer streams MP3 from Microsoft Edge TTS over websocket
type EdgeSynthesizer struct {
	mu     sync.RWMutex
	voice  string
	rate   string
	volume string
	pitch  string
}

func NewEdgeSynthesizer(voice, rate, volume, pitch string) *EdgeSynthesizer {
	if voice == "" {
		voice = "ru-RU-DmitryNeural"
	}
	if rate == "" {
		rate = "+0%"
	}
	if volume == "" {
		volume = "+0%"
	}
	if pitch == "" {
		pitch = "+0Hz"
	}
	return &EdgeSynthesizer{voice: voice, rate: rate, volume: volume, pitch: pitch}
}

// SetVoiceProfile switches voice and rate for subsequent syntheses
func (s *EdgeSynthesizer) SetVoiceProfile(voice, rate string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if voice != "" {
		s.voice = voice
	}
	if rate != "" {
		s.rate = rate
	}
}

func (s *EdgeSynthesizer) Synthesize(ctx context.Context, text string) ([]byte, error) {
	s.mu.RLock()
	voice, rate, volume, pitch := s.voice, s.rate, s.volume, s.pitch
	s.mu.RUnlock()
	if raw, err := directSynthesize(ctx, text, voice, rate, volume, pitch); err == nil {
		return raw, nil
	}
	comm, err := edge.NewCommunicate(text, voice, rate, volume, pitch, "", 10, 60)
	if err != nil {
		return nil, err
	}

	chunks, errs := comm.Stream(ctx)
	var buf bytes.Buffer
	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case chunk, ok := <-chunks:
			if !ok {
				select {
				case err := <-errs:
					if err != nil {
						return nil, err
					}
				default:
				}
				if buf.Len() == 0 {
					return nil, context.DeadlineExceeded
				}
				return buf.Bytes(), nil
			}
			if chunk.Type == "audio" {
				buf.Write(chunk.Data)
			}
		case err := <-errs:
			if err != nil {
				return nil, err
			}
		}
	}
}

func (s *EdgeSynthesizer) Close() error { return nil }
