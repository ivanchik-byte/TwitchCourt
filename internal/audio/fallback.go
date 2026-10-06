package audio

import (
	"context"
	"errors"
	"log"
)

// AutoSynthesizer cascades primary -> secondary synthesizer on error
type AutoSynthesizer struct {
	primary   Synthesizer
	secondary Synthesizer
}

func NewAutoSynthesizer(primary, secondary Synthesizer) *AutoSynthesizer {
	return &AutoSynthesizer{primary: primary, secondary: secondary}
}

func (s *AutoSynthesizer) Synthesize(ctx context.Context, text string) ([]byte, error) {
	if s.primary != nil {
		out, err := s.primary.Synthesize(ctx, text)
		if err == nil && len(out) > 0 {
			return out, nil
		}
		if err != nil {
			log.Printf("primary tts failed, using fallback: %v", err)
		}
	}
	if s.secondary != nil {
		return s.secondary.Synthesize(ctx, text)
	}
	return nil, errors.New("no synthesizer configured")
}

func (s *AutoSynthesizer) SetVoiceProfile(voice, rate string) {
	type profiler interface{ SetVoiceProfile(string, string) }
	if p, ok := s.primary.(profiler); ok {
		p.SetVoiceProfile(voice, rate)
	}
	if p, ok := s.secondary.(profiler); ok {
		p.SetVoiceProfile(voice, rate)
	}
}

func (s *AutoSynthesizer) Close() error {
	if s.primary != nil {
		s.primary.Close()
	}
	if s.secondary != nil {
		s.secondary.Close()
	}
	return nil
}
