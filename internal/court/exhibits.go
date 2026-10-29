package court

import (
	"fmt"

	"stream-tribunal/internal/obs"
)

func (e *Engine) RevealExhibit(trialID uint64, index int) (obs.ExhibitPayload, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	c := e.currCase
	if round := e.juryOpenLocked(); round != nil && round.number == 1 {
		return obs.ExhibitPayload{}, fmt.Errorf("close the first ballot before revealing evidence")
	}
	if c == nil || c.Demo || trialID != e.trialGen || e.state == StateIdle || e.state == StateJury || e.state == StateDeliberation || e.state == StateVerdict {
		return obs.ExhibitPayload{}, fmt.Errorf("this trial no longer accepts evidence")
	}
	if index < 0 || index >= len(c.Exhibits) {
		return obs.ExhibitPayload{}, fmt.Errorf("exhibit not found")
	}
	exhibit := c.Exhibits[index]
	view := obs.ExhibitPayload{TrialID: trialID, Index: index, Title: exhibit.Title, Text: exhibit.Text}
	if c.RevealedExhibits[index] {
		return view, nil
	}
	if c.RevealedExhibits == nil {
		c.RevealedExhibits = make(map[int]bool)
	}
	c.RevealedExhibits[index] = true
	c.Testimony = append(c.Testimony, "Дополнительная улика «"+exhibit.Title+"»: "+exhibit.Text)
	e.hub.BroadcastEvent(obs.EventExhibit, view)
	return view, nil
}
