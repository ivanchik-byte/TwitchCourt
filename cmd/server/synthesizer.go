package main

import (
	"stream-tribunal/internal/audio"
	"stream-tribunal/internal/config"
)

func buildSynthesizer(cfg *config.Config) audio.Synthesizer {
	lazyPiper := func() audio.Synthesizer {
		fallback, _ := audio.NewPiperDaemon(cfg.TTS)
		return fallback
	}

	if !cfg.TTS.Enabled {
		return lazyPiper()
	}

	switch cfg.TTS.Engine {
	case "piper":
		return lazyPiper()
	case "mock":
		return lazyPiper()
	case "silero":
		primary := audio.NewSileroSynthesizer(cfg.TTS.SileroURL, cfg.TTS.SileroJudge)
		if cfg.TTS.AutoFallback {
			return audio.NewAutoSynthesizer(primary, lazyPiper())
		}
		return primary
	default:
		primary := audio.NewEdgeSynthesizer(cfg.TTS.Voice, cfg.TTS.Rate, cfg.TTS.Volume, cfg.TTS.Pitch)
		if cfg.TTS.AutoFallback {
			return audio.NewAutoSynthesizer(primary, lazyPiper())
		}
		return primary
	}
}
