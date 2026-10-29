package court

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"stream-tribunal/internal/obs"
)

func juryEngine(t *testing.T, demo bool) *Engine {
	t.Helper()
	e := newWitnessEngine()
	e.hub = obs.NewHub(nil)
	e.trialGen, e.state = 7, StateTestimony
	e.currCase = &TrialCase{Demo: demo, Mode: "viewer"}
	e.openPhaseWindowLocked(30)
	t.Cleanup(e.TriggerPanic)
	return e
}

func openBallot(t *testing.T, e *Engine, number int) *obs.JuryPayload {
	t.Helper()
	view := e.JurySnapshot()
	opened, err := e.OpenJury(view.Epoch, view.TrialID, view.Revision, number, 20)
	if err != nil {
		t.Fatal(err)
	}
	return opened
}

func closeBallot(t *testing.T, e *Engine, id string) *obs.JuryPayload {
	t.Helper()
	view := e.JurySnapshot()
	closed, err := e.CloseJury(view.Epoch, view.TrialID, id)
	if err != nil {
		t.Fatal(err)
	}
	return closed
}

func TestJuryVoteReplacementPrivacyAndMatchedComparison(t *testing.T) {
	e := juryEngine(t, false)
	first := openBallot(t, e, 1)
	for _, vote := range [][2]string{{" Alice ", "1"}, {"alice", "1"}, {"ALICE", "2"}, {"bob", "2"}, {"clara", "1"}} {
		if !e.VoteJury(vote[0], vote[1]) {
			t.Fatal("valid vote rejected", vote)
		}
	}
	for _, vote := range [][2]string{{"bad nick", "1"}, {"alice", "9"}, {"alice", "1 2"}, {"al", "1"}} {
		if e.VoteJury(vote[0], vote[1]) {
			t.Fatal("invalid vote accepted", vote)
		}
	}
	raw, _ := json.Marshal(e.JurySnapshot())
	if strings.Contains(string(raw), `"guilty"`) || strings.Contains(string(raw), "alice") || e.JurySnapshot().First.Total != 3 {
		t.Fatal("open ballot leaked results, identities, or duplicated voters", string(raw))
	}
	closed := closeBallot(t, e, first.First.ID)
	if *closed.First.Guilty != 1 || *closed.First.Innocent != 2 {
		t.Fatal("replaced vote counted twice", closed.First)
	}
	if e.VoteJury("late", "1") {
		t.Fatal("closed ballot accepted vote")
	}
	e.mu.Lock()
	e.state = StateJury
	e.openPhaseWindowLocked(90)
	e.mu.Unlock()
	second := openBallot(t, e, 2)
	for _, vote := range [][2]string{{"alice", "1"}, {"bob", "2"}, {"newcomer", "1"}} {
		e.VoteJury(vote[0], vote[1])
	}
	end := closeBallot(t, e, second.Second.ID)
	if end.Comparison.Compared != 2 || end.Comparison.Changed != 1 {
		t.Fatal("new or missing voters distorted changed count", end.Comparison)
	}
	if e.Snapshot().Jury.Comparison.Changed != 1 {
		t.Fatal("reload lost comparison")
	}
	if _, err := e.TestJuryVote(end.Epoch, end.TrialID, second.Second.ID, "demo", "1"); err == nil {
		t.Fatal("rehearsal endpoint accepted live ballot")
	}
}

func TestJuryLifecycleGuardsAndNoSideEffects(t *testing.T) {
	e := juryEngine(t, false)
	e.currCase.Exhibits = []CaseExhibit{{Title: "Факт", Text: "Текст"}}
	initial := e.JurySnapshot()
	if _, err := e.OpenJury("old-server", initial.TrialID, initial.Revision, 1, 20); err == nil {
		t.Fatal("old server accepted")
	}
	if _, err := e.OpenJury(initial.Epoch, initial.TrialID, initial.Revision, 2, 20); err == nil {
		t.Fatal("second ballot opened before defense")
	}
	first := openBallot(t, e, 1)
	if _, err := e.OpenJury(initial.Epoch, initial.TrialID, initial.Revision, 1, 20); err == nil {
		t.Fatal("retry duplicated ballot")
	}
	if err := e.AdvancePhase(StateTestimony); err == nil {
		t.Fatal("open ballot advanced phase")
	}
	if _, err := e.RevealExhibit(initial.TrialID, 0); err == nil {
		t.Fatal("first ballot revealed late evidence")
	}
	closeBallot(t, e, first.First.ID)
	closeBallot(t, e, first.First.ID)
	if _, err := e.RevealExhibit(initial.TrialID, 0); err != nil {
		t.Fatal(err)
	}
	e.TriggerPanic()
	if e.JurySnapshot().First != nil || e.VoteJury("alice", "1") {
		t.Fatal("panic kept ballot alive")
	}
	if err := e.StartDemo("viewer"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.CloseJury(first.Epoch, first.TrialID, first.First.ID); err == nil {
		t.Fatal("stale ballot mutated new trial")
	}
}

func TestJuryRehearsalIsolationAndOptionalSecondRound(t *testing.T) {
	for _, skip := range []bool{false, true} {
		t.Run(fmt.Sprintf("skip=%v", skip), func(t *testing.T) {
			e := newWitnessEngine()
			e.hub = obs.NewHub(nil)
			var effects int
			e.VerdictHook = func(string, string, int, int, string) { effects++ }
			e.TimeoutHook = func(string, int, bool, string) { effects++ }
			if err := e.StartDemo("viewer"); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(e.TriggerPanic)
			if err := e.AdvancePhase(StateIndictment); err != nil {
				t.Fatal(err)
			}
			awaitPhase(t, e, StateTestimony)
			first := openBallot(t, e, 1)
			if e.VoteJury("real_chat", "1") {
				t.Fatal("live IRC altered rehearsal")
			}
			if _, err := e.TestJuryVote(first.Epoch, first.TrialID, first.First.ID, "demo_anya", "1"); err != nil {
				t.Fatal(err)
			}
			closeBallot(t, e, first.First.ID)
			for _, phase := range []State{StateTestimony, StateDefense, StateObjection} {
				awaitPhase(t, e, phase)
				if err := e.AdvancePhase(phase); err != nil {
					t.Fatal(err)
				}
			}
			awaitPhase(t, e, StateJury)
			if !skip {
				second := openBallot(t, e, 2)
				if _, err := e.TestJuryVote(second.Epoch, second.TrialID, first.First.ID, "demo_anya", "2"); err == nil {
					t.Fatal("old round accepted a test vote")
				}
				if _, err := e.TestJuryVote(second.Epoch, second.TrialID, second.Second.ID, "demo_anya", "2"); err != nil {
					t.Fatal(err)
				}
				closeBallot(t, e, second.Second.ID)
				if e.JurySnapshot().Comparison.Changed != 1 {
					t.Fatal("demo change missing")
				}
			}
			if err := e.AdvancePhase(StateJury); err != nil {
				t.Fatal(err)
			}
			awaitPhase(t, e, StateVerdict)
			if err := e.AdvancePhase(StateVerdict); err != nil {
				t.Fatal(err)
			}
			awaitPhase(t, e, StateIdle)
			if effects != 0 {
				t.Fatal("jury invoked moderation or announcements")
			}
		})
	}
}

func TestJuryConcurrentVotesAndVoterLimit(t *testing.T) {
	e := juryEngine(t, false)
	opened := openBallot(t, e, 1)
	var workers sync.WaitGroup
	for n := 0; n < 100; n++ {
		workers.Add(1)
		go func(n int) {
			defer workers.Done()
			e.VoteJury(fmt.Sprintf("voter_%d", n), "1")
			e.VoteJury(fmt.Sprintf("VOTER_%d", n), "2")
		}(n)
	}
	workers.Wait()
	view := closeBallot(t, e, opened.First.ID)
	if view.First.Total != 100 || *view.First.Guilty != 0 {
		t.Fatal("concurrent votes were lost or duplicated", view.First)
	}
	e.mu.Lock()
	viewRound := e.currCase.Jury.first
	viewRound.closed = false
	for i := 0; len(viewRound.votes) < maxJuryVoters; i++ {
		viewRound.votes[fmt.Sprintf("cap_%d", i)] = false
	}
	e.mu.Unlock()
	if e.VoteJury("extra_viewer", "1") || !e.VoteJury("voter_0", "1") {
		t.Fatal("voter limit rejected a replacement or allowed an extra voter")
	}
}

func TestJuryPausesAndResumesThePhaseDeadline(t *testing.T) {
	e := juryEngine(t, false)
	e.mu.Lock()
	advance := e.openPhaseWindowLocked(1)
	original := e.phaseDeadline
	c := e.currCase
	e.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	done := make(chan struct{})
	go func() { e.waitPhaseWindow(ctx, c, advance); close(done) }()
	opened := openBallot(t, e, 1)
	if e.Snapshot().TimeLeftSec > 1 {
		t.Fatal("phase clock includes ballot time")
	}
	time.Sleep(100 * time.Millisecond)
	closeBallot(t, e, opened.First.ID)
	e.mu.RLock()
	extension := e.phaseDeadline.Sub(original)
	e.mu.RUnlock()
	if extension < 90*time.Millisecond || extension > time.Second {
		t.Fatal("phase lost or gained unrelated time", extension)
	}
	select {
	case <-done:
	case <-ctx.Done():
		t.Fatal("phase did not resume after ballot")
	}
}

func TestJuryAutoCloseAndZeroVotes(t *testing.T) {
	e := juryEngine(t, false)
	view := e.JurySnapshot()
	opened, err := e.OpenJury(view.Epoch, view.TrialID, view.Revision, 1, 5)
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(6 * time.Second)
	for e.JurySnapshot().OpenRound != 0 {
		if time.Now().After(deadline) {
			t.Fatal("ballot did not close automatically")
		}
		time.Sleep(10 * time.Millisecond)
	}
	view = closeBallot(t, e, opened.First.ID)
	if view.First.Total != 0 || view.First.Guilty == nil || *view.First.Guilty != 0 {
		t.Fatal("empty ballot invented results")
	}
}
