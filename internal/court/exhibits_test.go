package court

import (
	"strings"
	"testing"

	"stream-tribunal/internal/obs"
)

func TestExhibitIsHiddenUntilRevealedAndDoesNotDuplicate(t *testing.T) {
	e := newWitnessEngine()
	e.hub = obs.NewHub(nil)
	e.trialGen = 9
	e.state = StateDefense
	e.currCase = &TrialCase{Crime: "Скрыл правду за ужином", ChatContext: "Исходный факт", Exhibits: []CaseExhibit{{Title: "Переписка", Text: "Он продолжил спор после ужина"}}}
	c := e.currCase
	if !strings.Contains(e.caseTestimony(c), c.Crime) {
		t.Fatal("counterargument lost the charge")
	}
	if strings.Contains(e.caseTestimony(c), "после ужина") {
		t.Fatal("unrevealed evidence reached the judge")
	}
	if _, err := e.RevealExhibit(8, 0); err == nil {
		t.Fatal("stale trial accepted")
	}
	if _, err := e.RevealExhibit(9, -1); err == nil {
		t.Fatal("invalid index accepted")
	}
	if _, err := e.RevealExhibit(9, 0); err != nil {
		t.Fatal(err)
	}
	if _, err := e.RevealExhibit(9, 0); err != nil {
		t.Fatal(err)
	}
	if len(c.Testimony) != 1 || !strings.Contains(e.caseTestimony(c), "Исходный факт") || !strings.Contains(e.caseTestimony(c), "после ужина") {
		t.Fatal("evidence lost or duplicated")
	}
	snapshot := e.Snapshot()
	if snapshot.TrialID != 9 || !snapshot.Exhibits[0].Revealed {
		t.Fatal("reload loses revealed state")
	}
}

func TestExhibitsCannotAlterClosedOrDemoTrials(t *testing.T) {
	for _, phase := range []State{StateIdle, StateDeliberation, StateVerdict} {
		e := newWitnessEngine()
		e.hub = obs.NewHub(nil)
		e.trialGen, e.state = 2, phase
		e.currCase = &TrialCase{Exhibits: []CaseExhibit{{Title: "Факт", Text: "Текст"}}}
		if _, err := e.RevealExhibit(2, 0); err == nil {
			t.Fatal("closed phase accepted evidence", phase)
		}
		if len(e.currCase.Testimony) != 0 {
			t.Fatal("closed trial was mutated")
		}
	}
	e := newWitnessEngine()
	e.hub = obs.NewHub(nil)
	e.trialGen, e.state = 3, StateDefense
	e.currCase = &TrialCase{Demo: true, Exhibits: []CaseExhibit{{Title: "Факт", Text: "Текст"}}}
	if _, err := e.RevealExhibit(3, 0); err == nil {
		t.Fatal("demo accepted real evidence")
	}
}
