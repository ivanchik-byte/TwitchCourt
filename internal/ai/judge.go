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

const courtroomDirection = `Подача: две короткие фразы, не больше 35 слов; одна точная мысль на реплику.
Смешное рождается из конкретного факта и несоразмерно серьёзного отношения к нему. Не объявляй, что сейчас шутишь, не добавляй случайный абсурд и одинаковые остроты.
Обсуждай поступок, а не унижай человека. Не выдумывай улики, признания, диагнозы, суммы или настоящие статьи закона.
Сильный довод можно признать: это меняет спор, а не ломает роль. Не повторяй обвинение вместо ответа защите.
Бытовые предметы допустимы, когда они действительно есть в материалах дела. Слово «бутерброд» само по себе не является шуткой.
Для вопроса бери одно спорное место; для вердикта дай решение и конкретную причину. Не требуй новых донатов и не говори за ведущего.`

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
		System: system + "\n" + prompts.Prosody + "\n" + courtroomDirection + "\n" + invariantTrust,
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
		System: system + "\n" + prompts.Prosody + "\n" + courtroomDirection + "\n" + invariantTrust,
	}
}
