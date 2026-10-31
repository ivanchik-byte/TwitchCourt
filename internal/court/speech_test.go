package court

import (
	"context"
	"testing"

	"stream-tribunal/internal/ai"
	"stream-tribunal/internal/config"
	"stream-tribunal/internal/obs"
	"stream-tribunal/internal/safety"
)

func TestSpeechSnapshotKeepsTheWholeQuestion(t *testing.T) {
	engine := NewEngine(config.DefaultConfig(), obs.NewHub(nil), nil, &castRecorder{}, safety.NewFilter(nil))
	engine.currCase = &TrialCase{Defendant: "viewer"}
	engine.state = StateIndictment
	parts := []string{"Суд изучил договорённость.", "Объясните, почему вы считали", "свой вариант оплаты справедливым?"}
	for index, text := range parts {
		if err := engine.speakAs(context.Background(), ai.SentenceChunk{Text: text}, index, false, "judge", "Судья", "", ""); err != nil {
			t.Fatal(err)
		}
	}
	for _, phase := range []State{StateIndictment, StateTestimony, StateDefense} {
		engine.state = phase
		view := engine.Snapshot()
		if view.FullLine != "Суд изучил договорённость. Объясните, почему вы считали свой вариант оплаты справедливым?" {
			t.Fatalf("%s lost the full question: %q", phase, view.FullLine)
		}
		if view.Line != parts[2] {
			t.Fatalf("scene subtitle changed: %q", view.Line)
		}
	}
}

func TestSpeechStartsFreshForAnotherTurn(t *testing.T) {
	engine := NewEngine(config.DefaultConfig(), obs.NewHub(nil), nil, &castRecorder{}, safety.NewFilter(nil))
	engine.currCase = &TrialCase{Defendant: "viewer"}
	steps := []struct {
		phase State
		index int
		role  string
		text  string
		want  string
	}{
		{StateIndictment, 0, "prosecutor", "Первый вопрос.", "Первый вопрос."},
		{StateIndictment, 1, "prosecutor", "Его продолжение.", "Первый вопрос. Его продолжение."},
		{StateObjection, 5, "prosecutor", "Ответ на защиту.", "Ответ на защиту."},
		{StateObjection, 6, "prosecutor", "<break time=\"100ms\"/> Ещё &quot;довод&quot;.", "Ответ на защиту. Ещё \"довод\"."},
		{StateObjection, 7, "judge", "Слово судьи.", "Слово судьи."},
		{StateObjection, 0, "judge", "Новая речь.", "Новая речь."},
		{StateObjection, -1, "judge", "Отдельная реплика.", "Отдельная реплика."},
	}
	for _, step := range steps {
		engine.state = step.phase
		if err := engine.speakAs(context.Background(), ai.SentenceChunk{Text: step.text}, step.index, false, step.role, step.role, "", ""); err != nil {
			t.Fatal(err)
		}
		if got := engine.Snapshot().FullLine; got != step.want {
			t.Fatalf("%s chunk %d: got %q, want %q", step.phase, step.index, got, step.want)
		}
	}
	engine.currCase = &TrialCase{Defendant: "viewer"}
	if err := engine.speakAs(context.Background(), ai.SentenceChunk{Text: "Другое дело."}, 0, false, "judge", "judge", "", ""); err != nil {
		t.Fatal(err)
	}
	if got := engine.Snapshot().FullLine; got != "Другое дело." {
		t.Fatalf("previous trial leaked into speech: %q", got)
	}
}
