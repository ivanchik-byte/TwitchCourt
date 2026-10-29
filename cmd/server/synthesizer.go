package main

import (
	"stream-tribunal/internal/audio"
	"stream-tribunal/internal/config"
)

func roleConfig(cfg *config.Config, role string) *config.Config {
	next := cfg.Clone()
	profile := cfg.TTS.Roles[role]
	switch cfg.TTS.Engine {
	case "edge":
		if role == "judge" && cfg.TTS.JudgeVoice != "" {
			next.TTS.Voice = cfg.TTS.JudgeVoice
		}
		if profile.EdgeVoice != "" {
			next.TTS.Voice = profile.EdgeVoice
		} else if role == "prosecutor" || role == "advocate" {
			next.TTS.Voice = "ru-RU-DmitryNeural"
		}
		if profile.Rate != "" {
			next.TTS.Rate = profile.Rate
		} else if role == "judge" && cfg.TTS.JudgeRate != "" {
			next.TTS.Rate = cfg.TTS.JudgeRate
		} else if role == "advocate" {
			next.TTS.Rate = "+8%"
		}
	case "silero":
		if profile.SileroVoice != "" {
			next.TTS.SileroJudge = profile.SileroVoice
		} else if role == "prosecutor" {
			next.TTS.SileroJudge = "eugene"
		} else if role == "advocate" {
			next.TTS.SileroJudge = "aidar"
		}
	case "elevenlabs":
		if profile.ElevenVoiceID != "" {
			next.TTS.ElevenVoiceID = profile.ElevenVoiceID
		}
	case "piper":
		if profile.PiperModelPath != "" {
			next.TTS.ModelPath = profile.PiperModelPath
			next.TTS.ConfigPath = profile.PiperModelPath + ".json"
		}
	}
	return next
}

func buildSynthesizer(cfg *config.Config) audio.Synthesizer {
	cast := &audio.Cast{Voices: make(map[string]audio.Synthesizer)}
	for _, role := range []string{"judge", "prosecutor", "advocate"} {
		cast.Voices[role] = buildSingleSynthesizer(roleConfig(cfg, role))
	}
	return cast
}

func buildSingleSynthesizer(cfg *config.Config) audio.Synthesizer {
	lazyPiper := func() audio.Synthesizer {
		fallback, _ := audio.NewPiperDaemon(cfg.TTS)
		return fallback
	}

	if !cfg.TTS.Enabled {
		return lazyPiper()
	}

	switch cfg.TTS.Engine {
	case "elevenlabs":
		primary := audio.NewElevenLabs(cfg.TTS.ElevenAPIKey, cfg.TTS.ElevenVoiceID, cfg.TTS.ElevenModelID, cfg.TTS.Delivery)
		if cfg.TTS.AutoFallback {
			return audio.NewAutoSynthesizer(primary, lazyPiper())
		}
		return primary
	case "piper":
		return lazyPiper()
	case "mock":
		muted := cfg.TTS
		muted.Enabled = false
		voice, _ := audio.NewPiperDaemon(muted)
		return voice
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

func ttsIsBeep(cfg *config.Config) bool {
	if !cfg.TTS.Enabled {
		return true
	}
	switch cfg.TTS.Engine {
	case "mock":
		return true

	default:
		return false
	}
}
