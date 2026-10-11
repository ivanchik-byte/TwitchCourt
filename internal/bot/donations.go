package bot

import (
	"crypto/rand"
	"math/big"
	"strings"
	"sync"
)

type DonationEvent struct {
	Donor    string
	Amount   float64
	Currency string
	Message  string
}

// Gate checks donations against per-currency thresholds
type Gate struct {
	mu       sync.RWMutex
	minimums map[string]float64
	fallback float64
}

func NewGate(minimums map[string]float64, fallback float64) *Gate {
	clone := make(map[string]float64, len(minimums))
	for code, amount := range minimums {
		clone[strings.ToUpper(strings.TrimSpace(code))] = amount
	}
	return &Gate{minimums: clone, fallback: fallback}
}

func (g *Gate) Pass(d DonationEvent) bool {
	g.mu.RLock()
	defer g.mu.RUnlock()
	if len(g.minimums) == 0 && g.fallback <= 0 {
		return true
	}
	code := strings.ToUpper(strings.TrimSpace(d.Currency))
	min, ok := g.minimums[code]
	if !ok {
		min = g.fallback
	}
	if min <= 0 {
		return true
	}
	return d.Amount >= min
}

func (g *Gate) SetMinimums(minimums map[string]float64, fallback float64) {
	g.mu.Lock()
	defer g.mu.Unlock()
	clone := make(map[string]float64, len(minimums))
	for code, amount := range minimums {
		clone[strings.ToUpper(strings.TrimSpace(code))] = amount
	}
	g.minimums = clone
	g.fallback = fallback
}

type Deck struct {
	mu    sync.RWMutex
	items []string
}

func NewDeck(items []string) *Deck {
	d := &Deck{}
	d.Set(items)
	return d
}

func (d *Deck) Set(items []string) {
	clean := make([]string, 0, len(items))
	for _, item := range items {
		trimmed := strings.TrimSpace(item)
		if trimmed != "" {
			clean = append(clean, trimmed)
		}
	}
	d.mu.Lock()
	d.items = clean
	d.mu.Unlock()
}

func (d *Deck) Draw() string {
	d.mu.RLock()
	defer d.mu.RUnlock()
	if len(d.items) == 0 {
		return ""
	}
	if len(d.items) == 1 {
		return d.items[0]
	}
	n, err := rand.Int(rand.Reader, big.NewInt(int64(len(d.items))))
	if err != nil {
		return d.items[0]
	}
	return d.items[n.Int64()]
}
