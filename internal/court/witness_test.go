package court

import (
	"strings"
	"testing"

	"stream-tribunal/internal/memory"
	"stream-tribunal/internal/safety"
)

func newWitnessEngine() *Engine {
	return &Engine{
		filter: safety.NewFilter(nil),
		recall: memory.NewStore(""),
		state:  StateIdle,
	}
}

func TestAddWitnessIdle(t *testing.T) {
	e := newWitnessEngine()
	if e.AddWitness("ivan", 150, "RUB", "он врет") {
		t.Fatal("idle court must reject witnesses")
	}
}

func TestAddWitnessActive(t *testing.T) {
	e := newWitnessEngine()
	e.state = StateIndictment
	e.currCase = &TrialCase{Defendant: "streamer", Voters: make(map[string]bool)}

	if !e.AddWitness("ivan", 150, "RUB", "убил курицу по дороге") {
		t.Fatal("active court must accept witnesses")
	}
	if len(e.currCase.Witnesses) != 1 {
		t.Fatalf("want 1 witness, got %d", len(e.currCase.Witnesses))
	}
	w := e.currCase.Witnesses[0]
	if w.Donor != "ivan" || w.Amount != 150 || w.Currency != "RUB" {
		t.Fatalf("bad witness fields: %+v", w)
	}

	if !e.AddWitness("", 50, "", "анонимка") {
		t.Fatal("anonymous testimony must attach")
	}
	if e.currCase.Witnesses[1].Donor != "Аноним" {
		t.Fatalf("empty donor must become Аноним, got %q", e.currCase.Witnesses[1].Donor)
	}
}

func TestBuildWitnessInterludeEmpty(t *testing.T) {
	if got := buildWitnessInterlude(nil); got != "" {
		t.Fatalf("empty witnesses must render nothing, got %q", got)
	}
}

func TestBuildWitnessInterlude(t *testing.T) {
	got := buildWitnessInterlude([]Witness{
		{Donor: "ivan", Amount: 150, Currency: "RUB", Message: "убил курицу по дороге"},
		{Donor: "maria", Amount: 5, Currency: "USD", Message: ""},
	})

	for _, want := range []string{"Суд приобщает", "ivan", "150", "RUB", "убил курицу", "maria", "Показания приобщены"} {
		if !strings.Contains(got, want) {
			t.Fatalf("interlude missing %q: %q", want, got)
		}
	}
}

func TestBuildWitnessInterludeUnescapes(t *testing.T) {
	got := buildWitnessInterlude([]Witness{
		{Donor: "ivan", Amount: 10, Currency: "RUB", Message: "рыба &amp; мясо"},
	})
	if strings.Contains(got, "&amp;") {
		t.Fatalf("speech line must not contain entities: %q", got)
	}
	if !strings.Contains(got, "рыба & мясо") {
		t.Fatalf("entities must unescape for speech: %q", got)
	}
}

func TestWitnessWeight(t *testing.T) {
	cases := []struct {
		n    int
		want int
	}{
		{0, 0},
		{1, 1},
		{3, 3},
		{5, maxWitnessWeight},
	}
	for _, c := range cases {
		witnesses := make([]Witness, c.n)
		if got := witnessWeight(witnesses); got != c.want {
			t.Fatalf("weight(%d) = %d, want %d", c.n, got, c.want)
		}
	}
}
