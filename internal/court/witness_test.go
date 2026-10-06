package court

import (
	"context"
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
	e := &Engine{
		filter: safety.NewFilter(nil),
		recall: memory.NewStore(""),
		state:  StateIdle,
	}
	e.SwapConfig(config.DefaultConfig())
	return e
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
	e.currCase = &TrialCase{Defendant: "streamer"}

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
	e.currCase = &TrialCase{Defendant: "streamer"}
	if !e.AddDefense("streamer", "я не виноват, кот всё видел") {
		t.Fatal("defense window must accept speech")
	}
	if !strings.Contains(e.currCase.Defense, "кот") {
		t.Fatalf("defense not stored: %q", e.currCase.Defense)
	}
	if e.AddDefense("streamer", "   ") {
		t.Fatal("empty defense must be rejected")
	}

	e.state = StateDeliberation
	if e.AddDefense("streamer", "опоздал") {
		t.Fatal("deliberating court must reject defense")
	}
}

func TestAddDefenseCapsLength(t *testing.T) {
	e := newWitnessEngine()
	e.state = StateDefense
	e.currCase = &TrialCase{Defendant: "streamer"}
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
	e.SwapConfig(config.DefaultConfig())
	if got := e.castVoice("ru-RU-DmitryNeural", "aidar"); got != "ru-RU-DmitryNeural" {
		t.Fatalf("edge engine must keep edge voice, got %q", got)
	}
	next := e.cfg.Load().Clone()
	next.TTS.Engine = "silero"
	e.SwapConfig(next)
	if got := e.castVoice("ru-RU-DmitryNeural", "aidar"); got != "aidar" {
		t.Fatalf("silero engine must map to speaker, got %q", got)
	}
	if got := e.castVoice("ru-RU-DmitryNeural", ""); got != "ru-RU-DmitryNeural" {
		t.Fatalf("empty silero speaker must fall back, got %q", got)
	}
}

func TestStartViewerTrialBusy(t *testing.T) {
	e := newWitnessEngine()
	e.state = StateDeliberation
	if err := e.StartViewerTrial("ivan", "спит на стриме"); err == nil {
		t.Fatal("busy court must reject viewer trial")
	}
}

// verify pipeline acquits and completes when model produces no verdict keyword
func TestViewerTrialRunsEndToEnd(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Courtroom.DefenseSec = 1
	voice, _ := audio.NewPiperDaemon(cfg.TTS)
	e := NewEngine(cfg, obs.NewHub(nil), ai.NewClient(cfg.AI), voice, safety.NewFilter(nil))
	e.AttachMemory(memory.NewStore(""))
	e.SetPunishments([]string{"присесть 10 раз"})

	timedOut := make(chan string, 1)
	e.TimeoutHook = func(user string, secs int, ban bool, reason string) {
		timedOut <- user
	}

	if err := e.StartViewerTrial("troll", "спит на стриме"); err != nil {
		t.Fatalf("viewer trial rejected: %v", err)
	}
	waitState(t, e, StateIdle, 60*time.Second)
	select {
	case got := <-timedOut:
		t.Fatalf("undecided bench must not jail, got %q", got)
	default:
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

func TestFinalizeVerdictJailsViewer(t *testing.T) {
	cfg := config.DefaultConfig()
	voice, _ := audio.NewPiperDaemon(cfg.TTS)
	e := NewEngine(cfg, obs.NewHub(nil), nil, voice, safety.NewFilter(nil))
	e.AttachMemory(memory.NewStore(""))

	var jailed string
	var term int
	var banned bool
	e.TimeoutHook = func(user string, secs int, isBan bool, reason string) {
		jailed, term, banned = user, secs, isBan
	}
	c := &TrialCase{Defendant: "troll", Crime: "спит", Viewer: "troll"}
	e.finalizeVerdict(context.Background(), c, true, true)
	if jailed != "troll" || term != 90 || banned {
		t.Fatalf("guilty viewer must be jailed 90s, got %q %d ban=%v", jailed, term, banned)
	}
	if e.GetState() != StateIdle {
		t.Fatalf("court must rest after verdict, got %q", e.GetState())
	}
}

func TestAddBribeOnce(t *testing.T) {
	e := newWitnessEngine()
	if e.AddBribe("ivan", 150, "RUB") {
		t.Fatal("idle court must reject bribes")
	}
	e.state = StateIndictment
	e.currCase = &TrialCase{Defendant: "streamer"}
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
