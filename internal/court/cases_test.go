package court

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"stream-tribunal/internal/audio"
	"stream-tribunal/internal/config"
	"stream-tribunal/internal/memory"
	"stream-tribunal/internal/obs"
	"stream-tribunal/internal/safety"
)

const deckFixture = `cases:
  - id: "a"
    title: "Слив катки"
    crime: "Вышел из катки"
  - id: "b"
    title: "Украл печеньки"
    crime: "Съел общие печеньки"
  - id: "c"
    title: "Спит на стриме"
    crime: "Храпит в микрофон"
`

func TestCaseEditingPreservesIdentityAndUsedStatus(t *testing.T) {
	d, recall := newTempDeck(t, deckFixture)
	d.Use("a")
	if err := d.Update(CaseCard{ID: "a", Title: "Новое название", Crime: "Новая статья", Context: "Новая улика", Details: "Подробности", DefenseExample: "Версия защиты"}); err != nil {
		t.Fatal(err)
	}
	if err := d.Reload(); err != nil {
		t.Fatal(err)
	}
	if d.Remaining() != 2 {
		t.Fatalf("editing replayed used case: %d", d.Remaining())
	}
	if used := recall.UsedCases(); len(used) != 1 || used[0] != "a" {
		t.Fatal(used)
	}
	for _, card := range d.List() {
		if card.ID == "a" && (card.Title != "Новое название" || card.Details != "Подробности" || card.DefenseExample != "Версия защиты") {
			t.Fatal(card)
		}
	}
	if err := d.Delete("b"); err != nil {
		t.Fatal(err)
	}
	if len(d.List()) != 2 || d.Remaining() != 1 {
		t.Fatal("delete lost or resurrected another card")
	}
}

func newTempDeck(t *testing.T, content string) (*CaseDeck, *memory.Store) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "cases.yaml")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	recall := memory.NewStore("")
	deck := NewCaseDeck(path, recall)
	if err := deck.Reload(); err != nil {
		t.Fatal(err)
	}
	return deck, recall
}

func TestDeckNoRepeats(t *testing.T) {
	deck, recall := newTempDeck(t, deckFixture)
	seen := map[string]bool{}
	for i := 0; i < 3; i++ {
		card, ok := deck.Draw()
		if !ok {
			t.Fatalf("draw %d failed", i)
		}
		if seen[card.ID] {
			t.Fatalf("repeat draw: %q", card.ID)
		}
		seen[card.ID] = true
	}
	if _, ok := deck.Draw(); ok {
		t.Fatal("exhausted deck must refuse")
	}
	if got := len(recall.UsedCases()); got != 3 {
		t.Fatalf("used ids must persist in memory, got %d", got)
	}
	deck.Reset()
	if _, ok := deck.Draw(); !ok {
		t.Fatal("reset deck must deal again")
	}
}

func TestDeckAddDelete(t *testing.T) {
	deck, _ := newTempDeck(t, "cases: []\n")
	card, err := deck.Add("Новое дело", "Что-то натворил", "", nil, "hand")
	if err != nil {
		t.Fatal(err)
	}
	if card.Source != "hand" || card.ID == "" {
		t.Fatalf("bad card: %+v", card)
	}
	if deck.Remaining() != 1 {
		t.Fatalf("want 1 remaining, got %d", deck.Remaining())
	}
	if err := deck.Delete(card.ID); err != nil {
		t.Fatal(err)
	}
	if deck.Remaining() != 0 {
		t.Fatal("deleted card must leave the deck")
	}
}

func TestStartCaseTrialFeedsDetails(t *testing.T) {
	e := newWitnessEngine()
	e.hub = obs.NewHub(nil)
	e.SetAI(mustAIClient(t, config.AIConfig{Provider: "custom", BaseURL: "http://127.0.0.1:9"}))
	pv, err := audio.NewPiperDaemon(config.TTSConfig{})
	if err != nil {
		t.Fatal(err)
	}
	e.SetVoice(pv)
	card := CaseCard{
		Title: "Тестовое дело", Crime: "Украл печеньки",
		Context: "Чат всё видел", Details: "Улики: крошки на клавиатуре.",
	}
	if err := e.StartCaseTrial("ivan", card, true); err != nil {
		t.Fatal(err)
	}
	if e.currCase == nil {
		t.Fatal("case must open")
	}
	if !strings.Contains(e.currCase.ChatContext, "Улики: крошки") {
		t.Fatalf("details must reach the bench: %q", e.currCase.ChatContext)
	}
	if e.currCase.Viewer != "ivan" {
		t.Fatalf("viewer path must keep opt-in defendant: %q", e.currCase.Viewer)
	}
	e.TriggerPanic()
}

func TestSimilar(t *testing.T) {
	if !similar("Слив катки", "Слив катки в финале") {
		t.Fatal("near-duplicate titles must match")
	}
	if similar("Слив катки", "Украл печеньки из чата") {
		t.Fatal("different cases must not match")
	}
}

func TestStartConfessionTrial(t *testing.T) {
	reply := `{"title": "Попкагейт", "crime": "Предал попку", "context": "Чат в шоке"}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"choices":[{"message":{"content":%s}}]}`, strconv.Quote(reply))
	}))
	defer server.Close()
	e := newWitnessEngine()
	e.hub = obs.NewHub(nil)
	e.SetAI(mustAIClient(t, config.AIConfig{Provider: "custom", APIKey: "k", BaseURL: server.URL, Stream: false}))
	pv, err := audio.NewPiperDaemon(config.TTSConfig{})
	if err != nil {
		t.Fatal(err)
	}
	e.SetVoice(pv)
	if err := e.StartConfessionTrial("bogdan", "предал попку"); err != nil {
		t.Fatalf("confession must open: %v", err)
	}
	if e.currCase == nil || !strings.Contains(e.currCase.ChatContext, "Самооговор") {
		t.Fatalf("confession must carry the description: %+v", e.currCase)
	}
	e.TriggerPanic()
}

func TestStartConfessionBanned(t *testing.T) {
	e := newWitnessEngine()
	if err := e.StartConfessionTrial("bogdan", "устроим теракт в чате"); err == nil {
		t.Fatal("banned confession must be refused")
	}
}

func TestGenerateCasesStoresBatch(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cases.yaml")
	if err := os.WriteFile(path, []byte("cases: []\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	batch := `[{"title": "Слив катки", "crime": "Вышел из катки", "context": ""}, {"title": "Теракт в чате", "crime": "Устроил теракт", "context": ""}]`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"choices":[{"message":{"content":%s}}]}`, strconv.Quote(batch))
	}))
	defer server.Close()
	cfg := config.DefaultConfig()
	cfg.AI.Provider = "custom"
	cfg.AI.APIKey = "k"
	cfg.AI.BaseURL = server.URL
	cfg.AI.Stream = false
	recall := memory.NewStore("")
	e := NewEngine(cfg, obs.NewHub(nil), mustAIClient(t, cfg.AI), nil, safety.NewFilter(nil))
	e.AttachMemory(recall)
	if err := e.LoadCases(path); err != nil {
		t.Fatal(err)
	}
	added, err := e.GenerateCases(5)
	if err != nil {
		t.Fatal(err)
	}
	if added != 1 {
		t.Fatalf("banned case must drop, want 1 added, got %d", added)
	}
	list := e.CaseDeck().List()
	if len(list) != 1 || list[0].Title != "Слив катки" || list[0].Source != "ai" {
		t.Fatalf("bad stored batch: %+v", list)
	}
}
