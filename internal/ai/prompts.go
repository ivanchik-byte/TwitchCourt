package ai

import (
	"fmt"

	"stream-tribunal/internal/config"
)

// Invariants are parser and format rules the desk must not break:
// persona texts in config can change the tone, never these lines.
const invariantTags = `Разрешены теги анимации: [slam] удар молотком, [shock] возмущение.
Тег [objection] запрещён в обвинении, он звучит только в фазе протеста.`

const invariantDeliberation = `Первое слово ответа: строго ВИНОВЕН или НЕВИНОВЕН, затем мотив.`

const invariantObjection = `Реплика обязана начинаться с тега [objection].`

func BuildIndictmentPrompt(defendant, crime, chatContext string) string {
	def := config.DefaultPrompts()
	return BuildIndictmentPromptWithMemory(defendant, crime, chatContext, "", def.TaskIndictment)
}

func BuildIndictmentPromptWithMemory(defendant, crime, chatContext, smartContext, task string) string {
	memory := ""
	if smartContext != "" {
		memory = "ИСТОРИЯ И КОНТЕКСТ:\n" + smartContext + "\n\n"
	}
	return fmt.Sprintf(`ПОДСУДИМЫЙ: %s
ОБВИНЕНИЕ: %s
КОНТЕКСТ ИЗ ЧАТА:
%s

%s%sЗАДАЧА:
%s`,
		defendant, crime, chatContext, memory, invariantTags+"\n\n", task)
}

func BuildCounterArgumentPrompt(streamerDefense string) string {
	def := config.DefaultPrompts()
	return BuildCounterArgumentPromptWithTask(streamerDefense, def.TaskCounter)
}

func BuildCounterArgumentPromptWithTask(streamerDefense, task string) string {
	return fmt.Sprintf(`ОПРАВДАНИЕ СТРИМЕРА: "%s"

%sЗАДАЧА:
%s`,
		streamerDefense, invariantObjection+"\n\n", task)
}

// BuildDeliberationPrompt asks the bench for a ruling starting with verdict keyword.
func BuildDeliberationPrompt(defendant, crime, testimony string) string {
	def := config.DefaultPrompts()
	return BuildDeliberationPromptWithTask(defendant, crime, testimony, def.TaskDeliberation)
}

func BuildDeliberationPromptWithTask(defendant, crime, testimony, task string) string {
	return fmt.Sprintf(`ПОДСУДИМЫЙ: %s
ОБВИНЕНИЕ: %s
ПОКАЗАНИЯ И ЗАЩИТА:
%s

%sЗАДАЧА:
%s`,
		defendant, crime, testimony, invariantDeliberation+"\n\n", task)
}
