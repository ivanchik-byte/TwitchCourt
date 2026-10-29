package main

import (
	"stream-tribunal/internal/config"
	"testing"
)

func TestRoleProfilesKeepIndependentVoices(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.TTS.Engine = "silero"
	cfg.TTS.Roles = map[string]config.RoleVoice{"advocate": {SileroVoice: "xenia", ElevenVoiceID: "defense-id"}}
	for role, want := range map[string]string{"judge": "kseniya", "prosecutor": "eugene", "advocate": "xenia"} {
		if got := roleConfig(cfg, role).TTS.SileroJudge; got != want {
			t.Fatalf("%s: want %s got %s", role, want, got)
		}
	}
	clone := cfg.Clone()
	clone.TTS.Roles["advocate"] = config.RoleVoice{SileroVoice: "aidar"}
	if cfg.TTS.Roles["advocate"].SileroVoice != "xenia" {
		t.Fatal("role map shared between configs")
	}
	cfg.TTS.Engine = "edge"
	if roleConfig(cfg, "advocate").TTS.Voice != "ru-RU-DmitryNeural" {
		t.Fatal("male advocate got the default female voice")
	}
	cfg.TTS.Engine = "elevenlabs"
	cfg.TTS.ElevenVoiceID = "judge-id"
	if roleConfig(cfg, "advocate").TTS.ElevenVoiceID != "defense-id" || roleConfig(cfg, "judge").TTS.ElevenVoiceID != "judge-id" {
		t.Fatal("wrong ElevenLabs speaker")
	}
}
