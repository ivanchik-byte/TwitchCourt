package ai

import "stream-tribunal/internal/config"

// JudgeStyle defines the courtroom judge persona.
type JudgeStyle struct {
	Name   string
	System string
}

// JudgeFor picks the bench voice; unknown styles fall back to strict.
// Persona texts come from config, brevity cap and prosody are appended here.
func JudgeFor(style string, prompts config.PromptsConfig) JudgeStyle {
	system := prompts.JudgeStrict
	name := "strict"
	if style == "cynical" {
		system = prompts.JudgeCynical
		name = "cynical"
	}
	if system == "" {
		def := config.DefaultPrompts()
		system = def.JudgeStrict
	}
	return JudgeStyle{
		Name:   name,
		System: system + "\nТвоя реплика ВСЕГДА состоит ровно из 2 предложений и не больше 35 слов.\n" + prompts.Prosody,
	}
}
