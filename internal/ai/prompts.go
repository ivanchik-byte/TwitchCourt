package ai

import "fmt"

// Prosody instructions for TTS generation (ellipses, stress marks, pauses)
const ProsodyDirection = `АУДИО-РЕЖИССУРА:
- Многоточия для вздохов и пауз: "Так-так-так... кто тут у нас..."
- Тире для смысловых ударов, междометия для живости: "Кхм...", "Позвольте!", "Ого!"
- Знак + перед ударной гласной в спорных словах: вин+овен, в+аша честь, казн+ить. Правило только для движка Silero, остальные его не понимают.
- Не чаще одного <break time="300ms" /> на реплику, только перед кульминацией.`

func BuildIndictmentPrompt(defendant, crime, chatContext string) string {
	return BuildIndictmentPromptWithMemory(defendant, crime, chatContext, "")
}

func BuildIndictmentPromptWithMemory(defendant, crime, chatContext, smartContext string) string {
	memory := ""
	if smartContext != "" {
		memory = "ИСТОРИЯ И КОНТЕКСТ:\n" + smartContext + "\n\n"
	}
	return fmt.Sprintf(`ПОДСУДИМЫЙ: %s
ОБВИНЕНИЕ: %s
КОНТЕКСТ ИЗ ЧАТА:
%s

%sЗАДАЧА:
Откройте судебное заседание. Громко объявите номер дела, назовите статью обвинения и сатирически уничтожьте аргументы стримера перед присяжными. Если подсудимый рецидивист, припомните прошлые приговоры. Если есть взятка донатом, отреагируйте на нее одной язвительной фразой. Закончите реплику вопросом или требованием ответа!`,
		defendant, crime, chatContext, memory)
}

func BuildCounterArgumentPrompt(streamerDefense string) string {
	return fmt.Sprintf(`ОПРАВДАНИЕ СТРИМЕРА: "%s"

ЗАДАЧА:
Мгновенно прервите стримера через [objection]! Реплика обязана начинаться с тега [objection].
Найдите слабое место в его оправдании и высмейте его перед чатом в 2 предложениях.`,
		streamerDefense)
}

// BuildDeliberationPrompt asks the bench for a ruling.
// The model must start its answer with either ВИНОВЕН or НЕВИНОВЕН.
func BuildDeliberationPrompt(defendant, crime, testimony string) string {
	return fmt.Sprintf(`ПОДСУДИМЫЙ: %s
ОБВИНЕНИЕ: %s
ПОКАЗАНИЯ И ЗАЩИТА:
%s

ЗАДАЧА:
Вынеси вердикт как Верховный Судья. Первое слово ответа — строго ВИНОВЕН или НЕВИНОВЕН, затем мотив двумя предложениями (не больше 35 слов) и коронная концовка «Суд окончен.»`,
		defendant, crime, testimony)
}
