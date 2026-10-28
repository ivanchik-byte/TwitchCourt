package court

import (
	"errors"
	"fmt"
	"time"

	"stream-tribunal/internal/obs"
)

var ErrAINotConfigured = errors.New("ai is not configured: set api_key or base_url in settings")

func trialMode(viewer string, prosecutor bool) string {
	if viewer != "" {
		return "viewer"
	}
	if !prosecutor {
		return "unban"
	}
	return "streamer"
}

func (e *Engine) openPhaseWindowLocked(seconds int) <-chan struct{} {
	e.phaseAdvance = make(chan struct{})
	e.phaseDeadline = time.Now().Add(time.Duration(seconds) * time.Second)
	return e.phaseAdvance
}

// AdvancePhase accepts the phase the operator actually saw, so a repeated
// request cannot accidentally advance the following window.
func (e *Engine) AdvancePhase(expected State) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.state != expected || e.phaseAdvance == nil {
		return fmt.Errorf("phase is no longer available for advance")
	}
	if (e.currCase == nil || !e.currCase.Demo) && e.state != StateTestimony && e.state != StateDefense && e.state != StateVerdict {
		return fmt.Errorf("wait for the current speech to finish")
	}
	close(e.phaseAdvance)
	e.phaseAdvance = nil
	return nil
}

// Snapshot restores an operator's view after reload or a socket reconnect.
func (e *Engine) Snapshot() obs.StateChangePayload {
	e.mu.RLock()
	defer e.mu.RUnlock()
	s := obs.StateChangePayload{State: string(e.state)}
	if c := e.currCase; c != nil {
		s.Defendant, s.Charge, s.Demo, s.Mode = c.Defendant, c.Crime, c.Demo, c.Mode
		s.Line, s.Verdict = c.LastLine, c.Verdict
	}
	if e.state == StateTestimony || e.state == StateDefense {
		remaining := time.Until(e.phaseDeadline)
		if remaining > 0 {
			s.TimeLeftSec = int((remaining + time.Second - 1) / time.Second)
		}
	}
	return s
}
