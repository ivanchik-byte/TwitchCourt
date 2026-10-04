package court

import (
	"html"
	"math/rand"
	"strings"

	"stream-tribunal/internal/obs"
)

// maxPool caps the line of willing defendants
const maxPool = 50

// maxTestimonyLines caps how many chat lines make it into the case
const maxTestimonyLines = 10

const maxTestimonyRunes = 200

// PoolSeat is one willing defendant with an optional self-charge
type PoolSeat struct {
	Nick   string
	Reason string
}

// Punishment is the streamer's chosen penalty for a guilty viewer
type Punishment struct {
	Kind string
	Secs int
}

// JoinPool lines a viewer up for the stand; reason is an optional self-charge
func (e *Engine) JoinPool(nick, reason string) (joined bool, position int) {
	clean := strings.TrimSpace(html.UnescapeString(e.filter.Sanitize(nick)))
	if clean == "" {
		return false, 0
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	for i, seat := range e.pool {
		if strings.EqualFold(seat.Nick, clean) {
			return false, i + 1
		}
	}
	if len(e.pool) >= maxPool {
		return false, 0
	}
	e.pool = append(e.pool, PoolSeat{Nick: clean, Reason: truncateRunes(html.UnescapeString(e.filter.Sanitize(reason)), maxTestimonyRunes)})
	return true, len(e.pool)
}

// LeavePool drops a viewer from the line
func (e *Engine) LeavePool(nick string) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	for i, seat := range e.pool {
		if strings.EqualFold(seat.Nick, nick) {
			e.pool = append(e.pool[:i], e.pool[i+1:]...)
			return true
		}
	}
	return false
}

// PoolList snapshots the line without disturbing it
func (e *Engine) PoolList() []PoolSeat {
	e.mu.RLock()
	defer e.mu.RUnlock()
	out := make([]PoolSeat, len(e.pool))
	copy(out, e.pool)
	return out
}

// PickRandom pulls one willing defendant off the line
func (e *Engine) PickRandom() (PoolSeat, bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if len(e.pool) == 0 {
		return PoolSeat{}, false
	}
	i := rand.Intn(len(e.pool))
	seat := e.pool[i]
	e.pool = append(e.pool[:i], e.pool[i+1:]...)
	return seat, true
}

// PickNick pulls a named viewer off the line
func (e *Engine) PickNick(nick string) (PoolSeat, bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	for i, seat := range e.pool {
		if strings.EqualFold(seat.Nick, nick) {
			e.pool = append(e.pool[:i], e.pool[i+1:]...)
			return seat, true
		}
	}
	return PoolSeat{}, false
}

// CurrentDefendant names who is on the stand right now
func (e *Engine) CurrentDefendant() string {
	e.mu.RLock()
	defer e.mu.RUnlock()
	if e.currCase == nil {
		return ""
	}
	return html.UnescapeString(e.currCase.Defendant)
}

// AddTestimony files a chat line from the current defendant;
// returns false when the author is not on the stand
func (e *Engine) AddTestimony(author, text string) bool {
	clean := strings.TrimSpace(html.UnescapeString(e.filter.Sanitize(text)))
	if clean == "" {
		return false
	}
	e.mu.Lock()
	if e.state == StateIdle || e.currCase == nil {
		e.mu.Unlock()
		return false
	}
	defendant := html.UnescapeString(e.currCase.Defendant)
	if defendant == "" || !strings.EqualFold(defendant, strings.TrimSpace(html.UnescapeString(e.filter.Sanitize(author)))) {
		e.mu.Unlock()
		return false
	}
	if len(e.currCase.Testimony) >= maxTestimonyLines {
		e.mu.Unlock()
		return true
	}
	line := truncateRunes(clean, maxTestimonyRunes)
	e.currCase.Testimony = append(e.currCase.Testimony, line)
	e.mu.Unlock()

	if e.hub != nil {
		e.hub.BroadcastEvent(obs.EventTestimony, obs.TestimonyPayload{Author: defendant, Text: line})
	}
	return true
}

// SetPunishment arms the streamer's chosen penalty for a guilty verdict
func (e *Engine) SetPunishment(kind string, secs int) Punishment {
	if kind != "ban" && kind != "pardon" {
		kind = "timeout"
	}
	if secs <= 0 {
		secs = 90
	}
	if secs > 1209600 {
		secs = 1209600
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	e.pendingPunishment = Punishment{Kind: kind, Secs: secs}
	return e.pendingPunishment
}

// GetPunishment reads the armed penalty
func (e *Engine) GetPunishment() Punishment {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.pendingPunishment
}

// AbortTrial drops the current case without a verdict (the sleepy button)
func (e *Engine) AbortTrial() bool {
	e.mu.Lock()
	if e.cancelFn != nil {
		e.cancelFn()
		e.cancelFn = nil
	}
	if e.state == StateIdle {
		e.mu.Unlock()
		return false
	}
	e.state = StateIdle
	e.currCase = nil
	e.mu.Unlock()

	e.hub.BroadcastEvent(obs.EventStateChange, obs.StateChangePayload{State: string(StateIdle)})
	return true
}
