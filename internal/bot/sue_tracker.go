package bot

import (
	"sync"
	"time"
)

// SueTracker counts !sue calls inside a sliding window and enforces
// a cooldown between auto-started trials so chat cannot DDoS the court.
type SueTracker struct {
	mu        sync.Mutex
	threshold int
	window    time.Duration
	cooldown  time.Duration
	calls     []time.Time
	lastTrial time.Time
}

// NewSueTracker builds a tracker. Non-positive threshold disables auto-start.
func NewSueTracker(threshold int, window, cooldown time.Duration) *SueTracker {
	return &SueTracker{threshold: threshold, window: window, cooldown: cooldown}
}

// Hit records a !sue and reports whether a trial should auto-start.
func (t *SueTracker) Hit(now time.Time) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.threshold <= 0 {
		return false
	}
	if now.Sub(t.lastTrial) < t.cooldown {
		return false
	}
	t.calls = append(t.calls, now)
	cutoff := now.Add(-t.window)
	kept := t.calls[:0]
	for _, c := range t.calls {
		if c.After(cutoff) {
			kept = append(kept, c)
		}
	}
	t.calls = kept
	if len(t.calls) >= t.threshold {
		t.lastTrial = now
		t.calls = nil
		return true
	}
	return false
}

// MarkTrial records a manually started trial for cooldown purposes.
func (t *SueTracker) MarkTrial(now time.Time) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.lastTrial = now
	t.calls = nil
}
