package court

import (
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestPackImportPreservesEditsAndPlayedCases(t *testing.T) {
	packs, err := CasePacks()
	if err != nil || len(packs) == 0 {
		t.Fatal(packs, err)
	}
	deck, recall := newTempDeck(t, deckFixture)
	pack := packs[0]
	added, err := deck.ImportPack(pack)
	if err != nil || added != len(pack.Cases) {
		t.Fatal(added, err)
	}
	played := pack.Cases[0]
	deck.Use(played.ID)
	played.Title = "Моя правка"
	if err := deck.Update(played); err != nil {
		t.Fatal(err)
	}
	remaining := deck.Remaining()
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if added, err := deck.ImportPack(pack); err != nil || added != 0 {
				t.Errorf("retry: %d %v", added, err)
			}
		}()
	}
	wg.Wait()
	if err := deck.Reload(); err != nil {
		t.Fatal(err)
	}
	if deck.Remaining() != remaining || len(deck.List()) != 3+len(pack.Cases) {
		t.Fatal("import duplicated or replayed cases")
	}
	found := false
	for _, card := range deck.List() {
		if card.ID == played.ID {
			found = true
			if card.Title != "Моя правка" || card.SourceURL != played.SourceURL {
				t.Fatal("import replaced local changes")
			}
		}
	}
	if !found || len(recall.UsedCases()) != 1 {
		t.Fatal("case or history lost")
	}
}

func TestPacksHaveSourcesAndPlayableMaterials(t *testing.T) {
	packs, err := CasePacks()
	if err != nil {
		t.Fatal(err)
	}
	ids := map[string]bool{}
	for _, pack := range packs {
		if pack.ID == "" || pack.Title == "" || len(pack.Cases) == 0 {
			t.Fatal("empty pack")
		}
		for _, card := range pack.Cases {
			link, err := url.Parse(card.SourceURL)
			if ids[card.ID] || card.ID == "" || err != nil || link.Scheme != "https" || link.Host != "www.reddit.com" {
				t.Fatal("invalid attribution or duplicate id", card.ID)
			}
			ids[card.ID] = true
			if card.Context == "" || card.Dilemma == "" || card.DefenseExample == "" || len(card.Exhibits) == 0 || len(card.Exhibits) > 3 {
				t.Fatal("incomplete case", card.ID)
			}
		}
	}
}

func TestWeightedCasesDoNotRepeatWithinOneDeck(t *testing.T) {
	deck, _ := newTempDeck(t, "cases:\n  - id: heavy\n    title: Heavy\n    crime: Charge\n    weight: 5\n  - id: light\n    title: Light\n    crime: Charge\n")
	first, ok := deck.Draw()
	if !ok {
		t.Fatal("first draw failed")
	}
	second, ok := deck.Draw()
	if !ok || second.ID == first.ID {
		t.Fatal("weighted case repeated")
	}
	if _, ok := deck.Draw(); ok {
		t.Fatal("deck should be exhausted")
	}
}

func TestAddFullCaseCreatesMissingDeck(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cases.yaml")
	deck := NewCaseDeck(path, nil)
	card, err := deck.AddCard(CaseCard{Title: "Дело", Crime: "Обвинение", Dilemma: "Спор", Exhibits: []CaseExhibit{{Title: "Новая улика", Text: "Дополнение"}}})
	if err != nil || card.ID == "" {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}
	if err := deck.Reload(); err != nil {
		t.Fatal(err)
	}
	if len(deck.List()) != 1 || deck.List()[0].Dilemma != "Спор" || len(deck.List()[0].Exhibits) != 1 {
		t.Fatal("full materials were not stored")
	}
}
