package audio

import "context"

// Synthesizer converts text into playable audio bytes.
// Implementations return either WAV (piper, mock) or MP3 (edge).
// The overlay decodes both via Web Audio, so no conversion here.
type Synthesizer interface {
	Synthesize(ctx context.Context, text string) ([]byte, error)
	Close() error
}
