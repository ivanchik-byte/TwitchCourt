package court

import (
	"sync"
	"time"
)

// Suspicion point values. A trial opens at 100, so a single
// ordinary event can never force a show on its own.
const (
	PointsDeath    = 20
	PointsEpicFail = 40
	PointsSueSpam  = 15
	PointsDonation = 25
	PointsMax      = 100
)

// Milestones at which the overlay teases the forming case.
var suspicionMilestones = []int{30, 60, 90}

// Pacing is the single gate for every automatic trial trigger.
// Log watchers, chat spam and donations only add suspicion points,
// a trial opens at 100 or on a platinum donation, and a global
// cooldown after each trial stops back-to-back shows.
type Pacing struct {
	mu            sync.Mutex
	meter         int
	firedLevels   map[int]bool
	cooldownUntil time.Time
	cooldown      time.Duration
}

// NewPacing builds the gate with the given post-trial cooldown.
func NewPacing(cooldown time.Duration) *Pacing {
	return &Pacing{
		firedLevels: make(map[int]bool),
		cooldown:    cooldown,
	}
}

// Add banks suspicion points. It reports whether the meter hit 100
// (open a trial), the current meter, and a newly crossed milestone
// level (0 when none). During cooldown points are ignored. When the
// court is busy (canFire false) the meter holds at 99 instead of
// firing into an occupied courtroom.
func (p *Pacing) Add(points int, now time.Time, canFire bool) (fired bool, meter int, milestone int) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if now.Before(p.cooldownUntil) {
		return false, p.meter, 0
	}
	p.meter += points
	if p.meter > PointsMax {
		p.meter = PointsMax
	}
	for _, level := range suspicionMilestones {
		if p.meter >= level && !p.firedLevels[level] {
			p.firedLevels[level] = true
			milestone = level
		}
	}
	if p.meter >= PointsMax {
		if !canFire {
			p.meter = PointsMax - 1
			return false, p.meter, milestone
		}
		p.meter = 0
		p.firedLevels = make(map[int]bool)
		return true, PointsMax, milestone
	}
	return false, p.meter, milestone
}

// Force opens the gate immediately, bypassing meter and cooldown.
// Reserved for platinum donations and manual starts.
func (p *Pacing) Force(now time.Time) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.meter = 0
	p.firedLevels = make(map[int]bool)
	p.cooldownUntil = now.Add(p.cooldown)
}

// MarkTrial records a finished opening: meter reset, cooldown armed.
func (p *Pacing) MarkTrial(now time.Time) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.meter = 0
	p.firedLevels = make(map[int]bool)
	p.cooldownUntil = now.Add(p.cooldown)
}

// Ready reports whether a new trial may open right now.
func (p *Pacing) Ready(now time.Time) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return !now.Before(p.cooldownUntil)
}

// Meter returns the current suspicion level for status displays.
func (p *Pacing) Meter() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.meter
}
