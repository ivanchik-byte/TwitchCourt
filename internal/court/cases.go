package court

import (
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"

	"stream-tribunal/internal/memory"
)

type CaseCard struct {
	ID             string   `yaml:"id" json:"id"`
	Title          string   `yaml:"title" json:"title"`
	Crime          string   `yaml:"crime" json:"crime"`
	Context        string   `yaml:"context,omitempty" json:"context,omitempty"`
	Details        string   `yaml:"details,omitempty" json:"details,omitempty"`
	DefenseExample string   `yaml:"defense_example,omitempty" json:"defense_example,omitempty"`
	Tags           []string `yaml:"tags,omitempty" json:"tags,omitempty"`
	Weight         int      `yaml:"weight,omitempty" json:"weight,omitempty"`
	Source         string   `yaml:"source,omitempty" json:"source,omitempty"`
}

// CaseDeck tracks remaining case cards and persists used IDs across restarts.
type CaseDeck struct {
	mu        sync.Mutex
	path      string
	recall    *memory.Store
	all       []CaseCard
	remaining []CaseCard
	fileMu    sync.Mutex
}

func NewCaseDeck(path string, recall *memory.Store) *CaseDeck {
	return &CaseDeck{path: path, recall: recall}
}

func (d *CaseDeck) Path() string {
	return d.path
}

func (d *CaseDeck) Reload() error {
	d.fileMu.Lock()
	defer d.fileMu.Unlock()
	raw, err := os.ReadFile(d.path)
	if err != nil {
		if os.IsNotExist(err) {
			d.mu.Lock()
			d.all, d.remaining = nil, nil
			d.mu.Unlock()
			return nil
		}
		return err
	}
	var file struct {
		Cases []CaseCard `yaml:"cases"`
	}
	if err := yaml.Unmarshal(raw, &file); err != nil {
		return err
	}
	used := map[string]bool{}
	if d.recall != nil {
		for _, id := range d.recall.UsedCases() {
			used[id] = true
		}
	}
	bag := make([]CaseCard, 0, len(file.Cases))
	for _, c := range file.Cases {
		if c.ID == "" || used[c.ID] {
			continue
		}
		w := c.Weight
		if w < 1 {
			w = 1
		}
		if w > 5 {
			w = 5
		}
		for i := 0; i < w; i++ {
			bag = append(bag, c)
		}
	}
	rand.Shuffle(len(bag), func(i, j int) { bag[i], bag[j] = bag[j], bag[i] })
	d.mu.Lock()
	d.all = file.Cases
	d.remaining = bag
	d.mu.Unlock()
	return nil
}

func (d *CaseDeck) Draw() (CaseCard, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if len(d.remaining) == 0 {
		return CaseCard{}, false
	}
	card := d.remaining[0]
	d.remaining = d.remaining[1:]
	if d.recall != nil {
		d.recall.MarkCaseUsed(card.ID)
	}
	return card, true
}

func (d *CaseDeck) Remaining() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	seen := map[string]bool{}
	for _, c := range d.remaining {
		seen[c.ID] = true
	}
	return len(seen)
}

func (d *CaseDeck) List() []CaseCard {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]CaseCard(nil), d.all...)
}

func (d *CaseDeck) Return(card CaseCard) {
	if card.ID == "" {
		return
	}
	d.mu.Lock()
	d.remaining = append([]CaseCard{card}, d.remaining...)
	d.mu.Unlock()
	if d.recall != nil {
		d.recall.UnmarkCaseUsed(card.ID)
	}
}

func (d *CaseDeck) Reset() {
	if d.recall != nil {
		d.recall.ResetUsedCases()
	}
	_ = d.Reload()
}

func (d *CaseDeck) Add(title, crime, context string, tags []string, source string) (CaseCard, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return CaseCard{}, fmt.Errorf("title is empty")
	}
	card := CaseCard{
		ID:      slug(title) + "-" + fmt.Sprintf("%d", time.Now().UnixNano()),
		Title:   title,
		Crime:   strings.TrimSpace(crime),
		Context: strings.TrimSpace(context),
		Tags:    tags,
		Weight:  1,
		Source:  source,
	}
	if card.Source == "" {
		card.Source = "hand"
	}
	block, err := yaml.Marshal([]CaseCard{card})
	if err != nil {
		return CaseCard{}, err
	}
	d.fileMu.Lock()
	// flow-style `cases: []` can't take appended block items: normalize once
	if raw, err := os.ReadFile(d.path); err == nil && strings.Contains(string(raw), "cases: []") {
		fixed := strings.Replace(string(raw), "cases: []", "cases:", 1)
		_ = os.WriteFile(d.path, []byte(fixed), 0o644)
	}
	f, err := os.OpenFile(d.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		d.fileMu.Unlock()
		return CaseCard{}, err
	}
	ls := strings.Split(strings.TrimRight(string(block), "\n"), "\n")
	// shift the whole item under `cases:`: dash by 2, continuations match it
	ls[0] = "  " + ls[0]
	for i := 1; i < len(ls); i++ {
		if strings.TrimSpace(ls[i]) != "" {
			ls[i] = "  " + ls[i]
		}
	}
	_, werr := f.WriteString("\n" + strings.Join(ls, "\n") + "\n")
	f.Close()
	d.fileMu.Unlock()
	if werr != nil {
		return CaseCard{}, werr
	}
	_ = d.Reload()
	return card, nil
}

func (d *CaseDeck) Delete(id string) error {
	return d.rewriteCase(id, nil)
}

func (d *CaseDeck) Update(card CaseCard) error {
	if strings.TrimSpace(card.Title) == "" || strings.TrimSpace(card.Crime) == "" {
		return fmt.Errorf("title and crime are required")
	}
	return d.rewriteCase(card.ID, &card)
}

func (d *CaseDeck) Use(id string) {
	d.mu.Lock()
	kept := d.remaining[:0]
	for _, card := range d.remaining {
		if card.ID != id {
			kept = append(kept, card)
		}
	}
	d.remaining = kept
	if d.recall != nil {
		d.recall.MarkCaseUsed(id)
	}
	d.mu.Unlock()
}

func (d *CaseDeck) rewriteCase(id string, replacement *CaseCard) error {
	d.fileMu.Lock()
	defer d.fileMu.Unlock()
	raw, err := os.ReadFile(d.path)
	if err != nil {
		return err
	}
	var file struct {
		Cases []CaseCard `yaml:"cases"`
	}
	if err := yaml.Unmarshal(raw, &file); err != nil {
		return err
	}
	kept := make([]CaseCard, 0, len(file.Cases))
	found := false
	for _, c := range file.Cases {
		if c.ID == id {
			found = true
			if replacement == nil {
				continue
			}
			c.Title, c.Crime, c.Context = strings.TrimSpace(replacement.Title), strings.TrimSpace(replacement.Crime), strings.TrimSpace(replacement.Context)
			c.Details, c.DefenseExample = replacement.Details, replacement.DefenseExample
		}
		kept = append(kept, c)
	}
	if !found {
		return fmt.Errorf("case %q not found", id)
	}
	raw, err = yaml.Marshal(struct {
		Cases []CaseCard `yaml:"cases"`
	}{Cases: kept})
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(d.path), "cases-*.yaml")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.WriteString(casesHeader + string(raw)); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp.Name(), d.path); err != nil {
		return err
	}
	// Reload takes fileMu; publish the already-parsed cards while still holding it.
	d.mu.Lock()
	d.all = kept
	remaining := d.remaining[:0]
	for _, pending := range d.remaining {
		if pending.ID != id {
			remaining = append(remaining, pending)
			continue
		}
		if replacement != nil {
			pending.Title, pending.Crime, pending.Context = replacement.Title, replacement.Crime, replacement.Context
			pending.Details, pending.DefenseExample = replacement.Details, replacement.DefenseExample
			remaining = append(remaining, pending)
		}
	}
	d.remaining = remaining
	d.mu.Unlock()
	return nil
}

const casesHeader = `# Case deck: random trials for the Draw button (see the Дела tab).
# Used ids persist in data/memory.json; POST /api/cases/reset reshuffles.
`

func slug(s string) string {
	lower := strings.ToLower(s)
	var sb strings.Builder
	prevDash := true
	for _, r := range lower {
		isWord := (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') ||
			(r >= 'а' && r <= 'я') || r == 'ё'
		if isWord {
			sb.WriteRune(r)
			prevDash = false
		} else if !prevDash {
			sb.WriteRune('-')
			prevDash = true
		}
	}
	out := strings.Trim(sb.String(), "-")
	if out == "" {
		out = "case"
	}
	runes := []rune(out)
	if len(runes) > 40 {
		out = string(runes[:40])
	}
	return out
}

func (e *Engine) LoadCases(path string) error {
	deck := NewCaseDeck(path, e.recall.Load())
	if err := deck.Reload(); err != nil {
		return err
	}
	e.mu.Lock()
	e.cases = deck
	e.mu.Unlock()
	return nil
}

func (e *Engine) CaseDeck() *CaseDeck {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.cases
}

func (e *Engine) RecentAuthors(n int) []string {
	recall := e.recall.Load()
	if recall == nil {
		return nil
	}
	cfg := e.cfg.Load()
	skip := map[string]bool{}
	for _, s := range []string{cfg.Game.StreamerName, cfg.Twitch.Nick, cfg.Twitch.Channel} {
		if s = strings.TrimSpace(s); s != "" {
			skip[strings.ToLower(s)] = true
		}
	}
	comments := recall.RecentComments(50)
	seen := map[string]bool{}
	var out []string
	for i := len(comments) - 1; i >= 0; i-- {
		author := strings.TrimSpace(comments[i].Author)
		if author == "" {
			continue
		}
		key := strings.ToLower(author)
		if seen[key] || skip[key] {
			continue
		}
		seen[key] = true
		out = append(out, author)
		if len(out) >= n {
			break
		}
	}
	sort.Strings(out)
	rand.Shuffle(len(out), func(i, j int) { out[i], out[j] = out[j], out[i] })
	return out
}
