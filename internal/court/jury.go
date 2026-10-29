package court

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	"stream-tribunal/internal/obs"
)

const maxJuryVoters = 10000

var juryNick = regexp.MustCompile(`^[a-z0-9_]{3,25}$`)

type juryRound struct {
	id       string
	number   int
	closed   bool
	deadline time.Time
	timer    *time.Timer
	votes    map[string]bool
	guilty   int
}

type juryBallot struct {
	first, second *juryRound
}

func (e *Engine) juryOpenLocked() *juryRound {
	if e.currCase == nil || e.currCase.Jury == nil {
		return nil
	}
	for _, round := range []*juryRound{e.currCase.Jury.first, e.currCase.Jury.second} {
		if round != nil && !round.closed {
			return round
		}
	}
	return nil
}

func (e *Engine) juryViewLocked() *obs.JuryPayload {
	view := &obs.JuryPayload{Epoch: e.juryEpoch, Revision: e.juryRevision, TrialID: e.trialGen}
	c := e.currCase
	if c == nil || e.state == StateIdle {
		return view
	}
	view.Demo = c.Demo
	view.CanFirst = e.state == StateTestimony && c.Jury == nil && e.phaseAdvance != nil && len(c.RevealedExhibits) == 0
	if c.Jury == nil {
		return view
	}
	view.CanSecond = e.state == StateJury && c.Jury.first.closed && c.Jury.second == nil && e.phaseAdvance != nil
	for _, round := range []*juryRound{c.Jury.first, c.Jury.second} {
		if round == nil {
			continue
		}
		public := &obs.JuryRound{ID: round.id, Number: round.number, Status: "open", Total: len(round.votes), ClosesAtMS: round.deadline.UnixMilli()}
		if round.closed {
			guilty, innocent := round.guilty, len(round.votes)-round.guilty
			public.Status, public.Guilty, public.Innocent = "closed", &guilty, &innocent
			public.ClosesAtMS = 0
		} else {
			view.OpenRound = round.number
		}
		if round.number == 1 {
			view.First = public
		} else {
			view.Second = public
		}
	}
	if c.Jury.second != nil && c.Jury.second.closed {
		view.Comparison = &obs.JuryComparison{}
		for nick, first := range c.Jury.first.votes {
			if second, voted := c.Jury.second.votes[nick]; voted {
				view.Comparison.Compared++
				if first != second {
					view.Comparison.Changed++
				}
			}
		}
	}
	return view
}

func (e *Engine) JurySnapshot() *obs.JuryPayload {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.juryViewLocked()
}

func (e *Engine) publishJuryLocked(phaseChanged bool) {
	e.juryRevision++
	if e.hub != nil {
		e.hub.BroadcastEvent(obs.EventJury, e.juryViewLocked())
		if phaseChanged {
			e.hub.BroadcastEvent(obs.EventStateChange, e.snapshotLocked())
		}
	}
	if phaseChanged && e.phaseWake != nil {
		select {
		case e.phaseWake <- struct{}{}:
		default:
		}
	}
}

func (e *Engine) OpenJury(epoch string, trialID, revision uint64, number, seconds int) (*obs.JuryPayload, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if epoch != e.juryEpoch || trialID != e.trialGen || revision != e.juryRevision || e.currCase == nil || e.juryOpenLocked() != nil {
		return nil, fmt.Errorf("ballot changed; refresh the desk")
	}
	view := e.juryViewLocked()
	if (number != 1 || !view.CanFirst) && (number != 2 || !view.CanSecond) {
		return nil, fmt.Errorf("this round is not available in the current phase")
	}
	if seconds < 5 || seconds > 60 {
		return nil, fmt.Errorf("ballot duration must be 5–60 seconds")
	}
	if !e.currCase.Demo && !time.Now().Before(e.phaseDeadline) {
		return nil, fmt.Errorf("phase has ended")
	}
	if number == 1 {
		e.currCase.Jury = &juryBallot{}
	}
	duration := time.Duration(seconds) * time.Second
	round := &juryRound{id: fmt.Sprintf("%s-%d-%d", epoch, trialID, number), number: number, deadline: time.Now().Add(duration), votes: make(map[string]bool)}
	if number == 1 {
		e.currCase.Jury.first = round
	} else {
		e.currCase.Jury.second = round
	}
	if !e.currCase.Demo {
		e.phaseDeadline = e.phaseDeadline.Add(duration)
	}
	round.timer = time.AfterFunc(duration, func() {
		e.mu.Lock()
		defer e.mu.Unlock()
		if epoch == e.juryEpoch && trialID == e.trialGen && e.juryOpenLocked() == round {
			e.closeJuryLocked(round)
		}
	})
	e.publishJuryLocked(true)
	return e.juryViewLocked(), nil
}

func (e *Engine) closeJuryLocked(round *juryRound) {
	round.closed = true
	round.timer.Stop()
	if !e.currCase.Demo {
		e.phaseDeadline = e.phaseDeadline.Add(-max(time.Until(round.deadline), 0))
	}
	e.publishJuryLocked(true)
}

func (e *Engine) CloseJury(epoch string, trialID uint64, pollID string) (*obs.JuryPayload, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if epoch != e.juryEpoch || trialID != e.trialGen || e.currCase == nil || e.currCase.Jury == nil {
		return nil, fmt.Errorf("this ballot no longer exists")
	}
	for _, round := range []*juryRound{e.currCase.Jury.first, e.currCase.Jury.second} {
		if round != nil && round.id == pollID {
			if !round.closed {
				e.closeJuryLocked(round)
			}
			return e.juryViewLocked(), nil
		}
	}
	return nil, fmt.Errorf("this ballot no longer exists")
}

// Chat votes bind to the round open when IRC delivers them; test votes require its exact ID.
func (e *Engine) VoteJury(nick, choice string) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.currCase == nil || e.currCase.Demo {
		return false
	}
	return e.voteJuryLocked(nick, choice)
}

func (e *Engine) TestJuryVote(epoch string, trialID uint64, pollID, nick, choice string) (*obs.JuryPayload, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	round := e.juryOpenLocked()
	if epoch != e.juryEpoch || trialID != e.trialGen || e.currCase == nil || !e.currCase.Demo || round == nil || round.id != pollID {
		return nil, fmt.Errorf("test votes require an open rehearsal ballot")
	}
	if !e.voteJuryLocked(nick, choice) {
		return nil, fmt.Errorf("invalid or expired vote")
	}
	return e.juryViewLocked(), nil
}

func (e *Engine) voteJuryLocked(nick, choice string) bool {
	round := e.juryOpenLocked()
	if round == nil || !time.Now().Before(round.deadline) {
		return false
	}
	nick, choice = strings.ToLower(strings.TrimSpace(nick)), strings.TrimSpace(choice)
	if !juryNick.MatchString(nick) || (choice != "1" && choice != "2") {
		return false
	}
	guilty := choice == "1"
	previous, voted := round.votes[nick]
	if voted && previous == guilty {
		return true
	}
	if !voted && len(round.votes) >= maxJuryVoters {
		return false
	}
	if voted && previous {
		round.guilty--
	}
	if guilty {
		round.guilty++
	}
	round.votes[nick] = guilty
	e.publishJuryLocked(false)
	return true
}

func (e *Engine) stopJuryLocked() {
	if round := e.juryOpenLocked(); round != nil {
		round.timer.Stop()
	}
}

func (e *Engine) runJuryWindow(ctx context.Context, c *TrialCase) {
	e.mu.Lock()
	if e.currCase != c || c.Jury == nil || ctx.Err() != nil {
		e.mu.Unlock()
		return
	}
	e.state = StateJury
	advance := e.openPhaseWindowLocked(90)
	e.hub.BroadcastEvent(obs.EventStateChange, e.snapshotLocked())
	e.mu.Unlock()
	e.waitPhaseWindow(ctx, c, advance)
}
