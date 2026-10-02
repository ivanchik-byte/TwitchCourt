package court

import (
	"testing"
	"time"
)

func TestPacingFiresAtHundred(t *testing.T) {
	p := NewPacing(10 * time.Minute)
	now := time.Now()

	fired, meter, milestone := p.Add(PointsDeath, now, true)
	if fired || meter != 20 || milestone != 0 {
		t.Fatalf("got fired=%v meter=%d milestone=%d", fired, meter, milestone)
	}
	fired, meter, milestone = p.Add(PointsEpicFail, now, true)
	if fired || meter != 60 || milestone != 60 {
		t.Fatalf("got fired=%v meter=%d milestone=%d", fired, meter, milestone)
	}
	fired, meter, _ = p.Add(PointsEpicFail, now, true)
	if !fired || meter != 100 {
		t.Fatalf("got fired=%v meter=%d", fired, meter)
	}
}

func TestPacingMilestonesFireOnce(t *testing.T) {
	p := NewPacing(0)
	now := time.Now()

	_, _, milestone := p.Add(30, now, true)
	if milestone != 30 {
		t.Fatalf("want milestone 30, got %d", milestone)
	}
	_, _, milestone = p.Add(5, now, true)
	if milestone != 0 {
		t.Fatalf("milestone must fire once, got %d", milestone)
	}
}

func TestPacingCooldownBlocks(t *testing.T) {
	p := NewPacing(10 * time.Minute)
	now := time.Now()

	p.MarkTrial(now)
	fired, meter, _ := p.Add(PointsMax, now.Add(time.Minute), true)
	if fired || meter != 0 {
		t.Fatalf("cooldown must block, got fired=%v meter=%d", fired, meter)
	}
	if p.Ready(now.Add(time.Minute)) {
		t.Fatal("must not be ready inside cooldown")
	}
	if !p.Ready(now.Add(11 * time.Minute)) {
		t.Fatal("must be ready after cooldown")
	}
}

func TestPacingForceBypasses(t *testing.T) {
	p := NewPacing(10 * time.Minute)
	now := time.Now()

	p.MarkTrial(now)
	p.Force(now.Add(time.Minute))
	if p.Meter() != 0 {
		t.Fatal("force must reset meter")
	}
}

func TestPacingHoldsWhenBusy(t *testing.T) {
	p := NewPacing(0)
	now := time.Now()

	fired, meter, _ := p.Add(PointsMax, now, false)
	if fired || meter != PointsMax-1 {
		t.Fatalf("busy court must hold at 99, got fired=%v meter=%d", fired, meter)
	}
	fired, meter, _ = p.Add(PointsDeath, now, true)
	if !fired || meter != PointsMax {
		t.Fatalf("free court must fire, got fired=%v meter=%d", fired, meter)
	}
}
