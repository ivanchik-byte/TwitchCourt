package audio

import (
	"context"
	"log"
)

// AutoSynthesizer tries primary first and falls back to secondary on error.
// Used as edge -> piper -> mock so the show continues without network.
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
	return nil, context.DeadlineExceeded
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
