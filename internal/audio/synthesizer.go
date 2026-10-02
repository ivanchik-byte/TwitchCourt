package audio

import "context"

// Synthesizer converts text into playable audio bytes (WAV or MP3)
type Synthesizer interface {
	Synthesize(ctx context.Context, text string) ([]byte, error)
	Close() error
}
