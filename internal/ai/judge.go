package ai

import (
	"math/rand"
	"strings"

	"stream-tribunal/internal/config"
)

// JudgeStyle defines the courtroom judge persona.
type JudgeStyle struct {
	Name   string
	System string
}

// JudgeFor resolves the judge persona prompt, falling back to strict.
func JudgeFor(style string, prompts config.PromptsConfig) JudgeStyle {
	name := strings.ToLower(strings.TrimSpace(style))
	if name == "random" {
		if rand.Intn(2) == 0 {
			name = "strict"
		} else {
			name = "cynical"
		}
	}
	system := prompts.JudgeStrict
	if name == "cynical" {
		system = prompts.JudgeCynical
		name = "cynical"
	} else {
		name = "strict"
	}
	if system == "" {
		def := config.DefaultPrompts()
		system = def.JudgeStrict
	}
	return JudgeStyle{
		Name:   name,
		System: system + "\nТвоя реплика ВСЕГДА состоит ровно из 2 предложений и не больше 35 слов.\n" + invariantTrust + "\n" + prompts.Prosody,
	}
}

// ProsecutorFor resolves the prosecutor persona prompt.
func ProsecutorFor(prompts config.PromptsConfig) JudgeStyle {
	system := prompts.Prosecutor
	if system == "" {
		system = config.DefaultPrompts().Prosecutor
	}
	return JudgeStyle{
		Name:   "prosecutor",
		System: system + "\nТвоя реплика ВСЕГДА состоит ровно из 2 предложений и не больше 35 слов.\n" + invariantTrust + "\n" + prompts.Prosody,
	}
}
