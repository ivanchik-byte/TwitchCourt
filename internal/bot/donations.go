package bot

import (
	"crypto/rand"
	"math/big"
	"strings"
	"sync"
)

// DonationEvent is a normalized donation from any source.
type DonationEvent struct {
	Donor    string
	Amount   float64
	Currency string
	Message  string
}

// Gate passes only donations that meet the per-currency minimum.
// Streamers set their own price per currency in settings.
type Gate struct {
	mu       sync.RWMutex
	minimums map[string]float64
	fallback float64
}

// NewGate builds a threshold gate. Empty minimums means everything passes.
func NewGate(minimums map[string]float64, fallback float64) *Gate {
	clone := make(map[string]float64, len(minimums))
	for code, amount := range minimums {
		clone[strings.ToUpper(strings.TrimSpace(code))] = amount
	}
	return &Gate{minimums: clone, fallback: fallback}
}

// Pass reports whether the donation opens a trial.
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

// SetMinimums replaces thresholds from settings.
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

// Deck holds streamer-defined punishments for guilty verdicts.
type Deck struct {
	mu    sync.RWMutex
	items []string
}

// NewDeck builds a punishment deck.
func NewDeck(items []string) *Deck {
	d := &Deck{}
	d.Set(items)
	return d
}

// Set replaces the deck, dropping blanks.
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

// Draw picks a random punishment. Empty deck means no punishment.
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

// Pending holds one queued donation while the court is busy.
// Latest wins so the show never stalls on a backlog.
type Pending struct {
	mu      sync.Mutex
	event   DonationEvent
	has     bool
	dropped int
}

// Push queues a donation, replacing any earlier one.
func (p *Pending) Push(d DonationEvent) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.has {
		p.dropped++
	}
	p.event = d
	p.has = true
}

// Pop takes the queued donation if any.
func (p *Pending) Pop() (DonationEvent, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.has {
		return DonationEvent{}, false
	}
	p.has = false
	return p.event, true
}
