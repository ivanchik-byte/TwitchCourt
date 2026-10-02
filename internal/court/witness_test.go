package court

import (
	"strings"
	"testing"
	"time"

	"stream-tribunal/internal/ai"
	"stream-tribunal/internal/audio"
	"stream-tribunal/internal/config"
	"stream-tribunal/internal/memory"
	"stream-tribunal/internal/obs"
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

func TestForceVerdict(t *testing.T) {
	e := newWitnessEngine()
	if e.ForceVerdict(true) {
		t.Fatal("idle court must reject forced verdict")
	}

	e.state = StateVoting
	e.currCase = &TrialCase{Defendant: "streamer", Voters: make(map[string]bool)}
	if !e.ForceVerdict(false) {
		t.Fatal("voting court must accept forced verdict")
	}
	if e.currCase.forceVerdict == nil || *e.currCase.forceVerdict {
		t.Fatal("forced verdict must stick as innocent")
	}
}

func TestSsmlBreakStrippedForDisplay(t *testing.T) {
	got := ssmlDisplayRe.ReplaceAllString(`Протестую. <break time="300ms" /> Слушаем.`, "")
	if strings.Contains(got, "<break") {
		t.Fatalf("break tag leaked to subtitles: %q", got)
	}
}

func TestAddDefenseWindow(t *testing.T) {
	e := newWitnessEngine()
	if e.AddDefense("streamer", "я не виноват") {
		t.Fatal("idle court must reject defense")
	}

	e.state = StateDefense
	e.currCase = &TrialCase{Defendant: "streamer", Voters: make(map[string]bool)}
	if !e.AddDefense("streamer", "я не виноват, кот всё видел") {
		t.Fatal("defense window must accept speech")
	}
	if !strings.Contains(e.currCase.Defense, "кот") {
		t.Fatalf("defense not stored: %q", e.currCase.Defense)
	}
	if e.AddDefense("streamer", "   ") {
		t.Fatal("empty defense must be rejected")
	}

	e.state = StateVoting
	if e.AddDefense("streamer", "опоздал") {
		t.Fatal("voting court must reject defense")
	}
}

func TestAddDefenseCapsLength(t *testing.T) {
	e := newWitnessEngine()
	e.state = StateDefense
	e.currCase = &TrialCase{Defendant: "streamer", Voters: make(map[string]bool)}
	if !e.AddDefense("streamer", strings.Repeat("слово ", 300)) {
		t.Fatal("long defense must attach")
	}
	if got := len([]rune(e.currCase.Defense)); got > maxDefenseRunes+3 {
		t.Fatalf("defense over cap: %d runes", got)
	}
}

func TestFallbackDefense(t *testing.T) {
	e := newWitnessEngine()
	if got := e.fallbackDefense(); got != "молчит как партизан" {
		t.Fatalf("empty transcript fallback: %q", got)
	}
	e.recall.AddComment("ivan", "он точно сам в лаву прыгнул")
	if got := e.fallbackDefense(); !strings.Contains(got, "ivan") {
		t.Fatalf("fallback misses chat: %q", got)
	}
}

func TestCastVoiceMapping(t *testing.T) {
	e := newWitnessEngine()
	e.cfg = config.DefaultConfig()
	if got := e.castVoice("ru-RU-DmitryNeural", "aidar"); got != "ru-RU-DmitryNeural" {
		t.Fatalf("edge engine must keep edge voice, got %q", got)
	}
	e.cfg.TTS.Engine = "silero"
	if got := e.castVoice("ru-RU-DmitryNeural", "aidar"); got != "aidar" {
		t.Fatalf("silero engine must map to speaker, got %q", got)
	}
	if got := e.castVoice("ru-RU-DmitryNeural", ""); got != "ru-RU-DmitryNeural" {
		t.Fatalf("empty silero speaker must fall back, got %q", got)
	}
}

func TestStartViewerTrialBusy(t *testing.T) {
	e := newWitnessEngine()
	e.state = StateVoting
	if err := e.StartViewerTrial("ivan", "спит на стриме"); err == nil {
		t.Fatal("busy court must reject viewer trial")
	}
}

// guilty viewer verdict must fire the chat-jail hook end to end
func TestViewerTrialTimeoutEndToEnd(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Courtroom.DefenseSec = 1
	cfg.Courtroom.VotingDurationSec = 2
	voice, _ := audio.NewPiperDaemon(cfg.TTS)
	e := NewEngine(cfg, obs.NewHub(nil), ai.NewClient(cfg.AI), voice, safety.NewFilter(nil))
	e.AttachMemory(memory.NewStore(""))
	e.SetPunishments([]string{"присесть 10 раз"})

	timedOut := make(chan string, 1)
	e.TimeoutHook = func(user string, secs int, reason string) {
		if secs != 90 {
			t.Errorf("jail term must be 90s, got %d", secs)
		}
		timedOut <- user
	}

	if err := e.StartViewerTrial("troll", "спит на стриме"); err != nil {
		t.Fatalf("viewer trial rejected: %v", err)
	}
	waitState(t, e, StateVoting, 30*time.Second)
	if !e.ForceVerdict(true) {
		t.Fatal("force verdict rejected")
	}
	waitState(t, e, StateIdle, 30*time.Second)
	select {
	case got := <-timedOut:
		if got != "troll" {
			t.Fatalf("wrong user jailed: %q", got)
		}
	default:
		t.Fatal("guilty viewer verdict must fire the timeout hook")
	}
}

func waitState(t *testing.T, e *Engine, want State, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for e.GetState() != want {
		if time.Now().After(deadline) {
			t.Fatalf("never reached %q, stuck in %q", want, e.GetState())
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func TestAddBribeOnce(t *testing.T) {
	e := newWitnessEngine()
	if e.AddBribe("ivan", 150, "RUB") {
		t.Fatal("idle court must reject bribes")
	}
	e.state = StateIndictment
	e.currCase = &TrialCase{Defendant: "streamer", Voters: make(map[string]bool)}
	if !e.AddBribe("ivan", 150, "RUB") {
		t.Fatal("active court must accept the first bribe")
	}
	if e.AddBribe("maria", 500, "RUB") {
		t.Fatal("second bribe must be rejected")
	}
	if !e.currCase.Bribed {
		t.Fatal("bribe flag not set")
	}
}
