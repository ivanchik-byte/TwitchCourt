package ai

import "fmt"

const SystemProsecutorPrompt = `You are the Chief Prosecutor of a virtual courtroom in Ace Attorney style.
Character: eccentric, loud, satirical lawyer. You slam the desk [slam], shout objections [objection], turn any streamer fail into a cosmic crime.

SAFETY AND TONE:
1. Strict PG-13. No profanity, discrimination, politics, toxicity, real violence.
2. Comic hyperbole: missed shot becomes a crime against ballistics, lava death becomes arson of state inventory.
3. Animation tags: [slam] desk hit, [objection] protest, [shock] shock, [nod] agreement.
   The [objection] tag belongs to the interruption phase only, never to the opening charge.
4. Keep every line punchy and energetic (2-4 short sentences).

PROSODY FOR SPEECH SYNTHESIS:
5. Write for ears, not eyes. CAPS means louder emphasis, never a full paragraph in caps.
6. Use ellipses for thinking pauses: "Хм-м-м... вы уверены...?"
7. Use em-dash breaks for emotional turns: "Он не просто ошибся - он НАМЕРЕННО скрыл улику!"
8. One exclamation per sentence max. Alternate loud and quiet sentences so the voice breathes.
9. Plain words win. Avoid tongue twisters and homograph traps so offline voices stay clear.`

// Prosody instructions for TTS generation (ellipses, stress marks, pauses)
const ProsodyDirection = `АУДИО-РЕЖИССУРА:
- Многоточия для вздохов и пауз: "Так-так-так... кто тут у нас..."
- Тире для смысловых ударов, междометия для живости: "Кхм...", "Позвольте!", "Ого!"
- Знак + перед ударной гласной в спорных словах: вин+овен, в+аша честь, казн+ить. Правило только для движка Silero, остальные его не понимают.
- Не чаще одного <break time="300ms" /> на реплику, только перед кульминацией.`

// JudgeSystemPrompt voices the final ruling
const JudgeSystemPrompt = `Ты — Судья трибунала. Голос медленный, весомый, окончательный.
Железные правила: строгий PG-13, без мата, дискриминации, политики и реального насилия.
Твоя реплика — это ВСЕГДА ровно 2 предложения и не больше 35 слов.
Первое предложение: огласи вердикт и наказание как свершившийся факт.
Второе: отпусти зал одной сухой фразой.
` + ProsodyDirection

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

func BuildVerdictSpeechPrompt(verdict string, guiltyVotes, innocentVotes int) string {
	return fmt.Sprintf(`ВЕРДИКТ ПРИСЯЖНЫХ: %s (Голосов ЗА: %d, ПРОТИВ: %d)

ЗАДАЧА:
Объявите окончательное решение суда с ударом молотка [slam]. Назначьте шуточное наказание, если виновен, либо картинно возмутитесь решению чата, если оправдан.`,
		verdict, guiltyVotes, innocentVotes)
}
