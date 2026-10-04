package court

import (
	"testing"

	"stream-tribunal/internal/memory"
	"stream-tribunal/internal/obs"
	"stream-tribunal/internal/safety"
)

func TestPoolJoinLeavePick(t *testing.T) {
	e := newWitnessEngine()
	if ok, pos := e.JoinPool("Ivan", "спит"); !ok || pos != 1 {
		t.Fatalf("first join must take position 1, got %v %d", ok, pos)
	}
	if ok, pos := e.JoinPool("ivan", "еще"); ok || pos != 1 {
		t.Fatalf("duplicate nick must be rejected, got %v %d", ok, pos)
	}
	if _, _ = e.JoinPool("maria", ""); len(e.PoolList()) != 2 {
		t.Fatalf("want pool of 2, got %d", len(e.PoolList()))
	}
	if !e.LeavePool("IVAN") {
		t.Fatal("leave must match case-insensitively")
	}
	if e.LeavePool("ghost") {
		t.Fatal("leaving an empty seat must fail")
	}
	seat, ok := e.PickRandom()
	if !ok || seat.Nick != "maria" {
		t.Fatalf("last seat must be maria, got %+v %v", seat, ok)
	}
	if _, ok := e.PickRandom(); ok {
		t.Fatal("empty pool must pick nothing")
	}
}

func TestAddTestimonyGating(t *testing.T) {
	e := newWitnessEngine()
	if e.AddTestimony("troll", "я не виноват") {
		t.Fatal("idle court must reject testimony")
	}
	e.state = StateTestimony
	e.currCase = &TrialCase{Defendant: "troll"}
	if !e.AddTestimony("troll", "я не виноват, кот видел") {
		t.Fatal("defendant must testify")
	}
	if e.AddTestimony("heckler", "он врет") {
		t.Fatal("hecklers must not enter the record")
	}
	if e.AddTestimony("troll", "   ") {
		t.Fatal("empty lines must be rejected")
	}
	if got := e.caseTestimony(e.currCase); got == "" {
		t.Fatal("testimony must reach the bench")
	}
}

func TestPunishmentValidation(t *testing.T) {
	e := newWitnessEngine()
	if got := e.SetPunishment("ban", 0); got.Kind != "ban" {
		t.Fatalf("ban must stick, got %+v", got)
	}
	if got := e.SetPunishment("nonsense", -5); got.Kind != "timeout" || got.Secs != 90 {
		t.Fatalf("garbage must fall back to 90s timeout, got %+v", got)
	}
	if got := e.SetPunishment("pardon", 60); got.Kind != "pardon" {
		t.Fatalf("pardon must stick, got %+v", got)
	}
	if got := e.GetPunishment(); got.Kind != "pardon" {
		t.Fatalf("punishment must persist, got %+v", got)
	}
}

func TestAbortTrial(t *testing.T) {
	e := NewEngine(nil, obs.NewHub(nil), nil, nil, safety.NewFilter(nil))
	e.AttachMemory(memory.NewStore(""))
	if e.AbortTrial() {
		t.Fatal("idle court has nothing to abort")
	}
	e.state = StateTestimony
	e.currCase = &TrialCase{Defendant: "troll"}
	if !e.AbortTrial() {
		t.Fatal("active trial must abort")
	}
	if e.GetState() != StateIdle || e.CurrentDefendant() != "" {
		t.Fatal("abort must clear the stand")
	}
}
