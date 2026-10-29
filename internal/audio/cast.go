package audio

import (
	"context"
	"errors"
)

type Cast struct{ Voices map[string]Synthesizer }

func (c *Cast) Synthesize(ctx context.Context, text string) ([]byte, error) {
	return c.SynthesizeRole(ctx, text, "judge")
}

func (c *Cast) SynthesizeRole(ctx context.Context, text, role string) ([]byte, error) {
	voice := c.Voices[role]
	if voice == nil {
		voice = c.Voices["judge"]
	}
	return voice.Synthesize(ctx, text)
}

func (c *Cast) Close() error {
	var failures []error
	for _, voice := range c.Voices {
		failures = append(failures, voice.Close())
	}
	return errors.Join(failures...)
}
