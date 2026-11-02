package court

import (
	"context"
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
	e.phaseWake = make(chan struct{}, 1)
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
	if e.juryOpenLocked() != nil {
		return fmt.Errorf("close the jury ballot before advancing")
	}
	if (e.currCase == nil || !e.currCase.Demo) && e.state != StateTestimony && e.state != StateDefense && e.state != StateJury && e.state != StateVerdict {
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
	return e.snapshotLocked()
}

func (e *Engine) snapshotLocked() obs.StateChangePayload {
	s := obs.StateChangePayload{State: string(e.state), Jury: e.juryViewLocked()}
	if c := e.currCase; c != nil {
		s.Appeal = c.Appeal
		s.TrialID = e.trialGen
		for i, exhibit := range c.Exhibits {
			s.Exhibits = append(s.Exhibits, obs.ExhibitView{Index: i, Title: exhibit.Title, Text: exhibit.Text, Revealed: c.RevealedExhibits[i]})
		}
		s.Defendant, s.Charge, s.Demo, s.Mode = c.Defendant, c.Crime, c.Demo, c.Mode
		s.Line, s.Verdict = c.LastLine, c.Verdict
		s.FullLine = c.FullLine
		s.Role, s.Speaker = c.LastRole, c.LastSpeaker
	}
	if e.state == StateTestimony || e.state == StateDefense || e.state == StateJury {
		remaining := time.Until(e.phaseDeadline)
		if round := e.juryOpenLocked(); round != nil && !e.currCase.Demo {
			remaining -= max(time.Until(round.deadline), 0)
		}
		if remaining > 0 {
			s.TimeLeftSec = int((remaining + time.Second - 1) / time.Second)
		}
	}
	return s
}

func (e *Engine) waitPhaseWindow(ctx context.Context, c *TrialCase, advance <-chan struct{}) {
	for {
		e.mu.RLock()
		deadline, wake := e.phaseDeadline, e.phaseWake
		current := e.currCase == c
		e.mu.RUnlock()
		if !current || ctx.Err() != nil {
			return
		}
		timer := time.NewTimer(max(time.Until(deadline), 0))
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-advance:
			timer.Stop()
			return
		case <-wake:
			timer.Stop()
		case <-timer.C:
			e.mu.RLock()
			expired := !time.Now().Before(e.phaseDeadline) && e.juryOpenLocked() == nil
			e.mu.RUnlock()
			if expired {
				return
			}
		}
	}
}

func (e *Engine) RecordAppealDecision(id string, approved bool) {
	e.mu.Lock()
	if e.currCase == nil || e.currCase.Appeal == nil || e.currCase.Appeal.ID != id {
		e.mu.Unlock()
		return
	}
	e.currCase.Appeal = &obs.AppealState{ID: id, Resolved: true, Approved: approved}
	view := e.snapshotLocked()
	e.mu.Unlock()
	e.hub.BroadcastEvent(obs.EventStateChange, view)
}
