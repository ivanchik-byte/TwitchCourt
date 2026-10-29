package court

import (
	"context"
	"fmt"
	"time"

	"stream-tribunal/internal/obs"
)

type demoScript struct {
	defendant, crime, opening, response, verdict, penalty string
}

var demoScripts = map[string]demoScript{
	"viewer": {
		"night_owl", "Объявил, что идёт спать, и ещё четыре часа давал советы в чате.",
		"Подсудимый, ваше «спокойной ночи» содержит сорок семь сообщений. Последнее — «там же справа был» в 03:47. Суд требует объяснений.",
		"Суд услышал защиту. Следить за прохождением босса — общественная работа, однако подсудимый сам выбрал ночную смену.",
		"НЕВИНОВЕН", "Присвоить звание внештатного ночного смотрителя. Рабочий день официально окончен.",
	},
	"streamer": {
		"Стример", "Обещал последнюю катку. Это было семь каток назад.",
		"Обвинение предъявляет семь последних каток. Слово «последняя» в ваших устах стало единицей времени. Подсудимый, сколько их ещё в сутках?",
		"Прокурор отмечает: фраза «эта точно последняя» уже есть в материалах дела. Семь раз. Новых доказательств защита не представила.",
		"ВИНОВЕН", "До конца следующей катки обращаться к чату исключительно «уважаемая коллегия».",
	},
	"unban": {
		"caps_enjoyer", "Учебная апелляция: писал капсом после трёх предупреждений. Просит второй шанс.",
		"Защита признаёт: мой клиент повышал регистр. Но в апелляции он впервые нашёл строчные буквы. Прошу приобщить этот прогресс к делу.",
		"Защита услышала возражения ведущего. Испытательный срок позволит проверить раскаяние лучше, чем очередное обещание. Решение остаётся за ведущим.",
		"НЕВИНОВЕН", "Рекомендация: второй шанс с испытательным сроком. Это учебное дело, заявка в Twitch не меняется.",
	},
}

// StartDemo exercises the same state and overlay events without an AI request,
// speech synthesis, history writes, donations, or Twitch moderation hooks.
func (e *Engine) StartDemo(mode string) error {
	script, ok := demoScripts[mode]
	if !ok {
		return fmt.Errorf("unknown demo mode")
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.state != StateIdle {
		return fmt.Errorf("court is already in session")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	e.cancelFn, e.trialCancel = cancel, cancel
	e.trialGen++
	gen := e.trialGen
	c := &TrialCase{Defendant: script.defendant, Crime: script.crime, Demo: true, Mode: mode}
	e.currCase, e.state = c, StateIndictment
	advance := e.demoStepLocked(StateIndictment, script.opening)
	go e.runDemo(ctx, cancel, gen, script, advance)
	return nil
}

func (e *Engine) demoStepLocked(state State, line string) <-chan struct{} {
	e.state = state
	advance := e.openPhaseWindowLocked(0)
	e.hub.BroadcastEvent(obs.EventStateChange, obs.StateChangePayload{
		State: string(state), Defendant: e.currCase.Defendant, Charge: e.currCase.Crime,
		Demo: true, Mode: e.currCase.Mode,
	})
	if line != "" {
		e.currCase.LastLine = line
		e.hub.BroadcastEvent(obs.EventSubtitles, obs.SubtitlesPayload{Speaker: "Судья · репетиция", Text: line})
	}
	return advance
}

func (e *Engine) runDemo(ctx context.Context, cancel context.CancelFunc, gen uint64, script demoScript, advance <-chan struct{}) {
	defer cancel()
	defer e.restIdle(gen)
	steps := []struct {
		state State
		line  string
	}{
		{StateTestimony, ""}, {StateDefense, ""},
		{StateObjection, script.response}, {StateJury, ""}, {StateVerdict, script.penalty},
	}
	for _, step := range steps {
		if step.state == StateJury {
			e.mu.RLock()
			enabled := e.currCase != nil && e.currCase.Jury != nil
			e.mu.RUnlock()
			if !enabled {
				continue
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-advance:
		}
		e.mu.Lock()
		if ctx.Err() != nil || e.trialGen != gen {
			e.mu.Unlock()
			return
		}
		advance = e.demoStepLocked(step.state, step.line)
		if step.state == StateVerdict {
			verdict := obs.VerdictPayload{Verdict: script.verdict, Penalty: script.penalty}
			e.currCase.Verdict = &verdict
			e.hub.BroadcastEvent(obs.EventVerdict, verdict)
		}
		e.mu.Unlock()
	}
	select {
	case <-ctx.Done():
	case <-advance:
	}
}
