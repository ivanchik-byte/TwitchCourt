package court

import (
	"sync"
	"time"
)

// suspicion point values; trial opens at 100
const (
	PointsDeath    = 20
	PointsEpicFail = 40
	PointsSueSpam  = 15
	PointsDonation = 25
	PointsMax      = 100
)

var suspicionMilestones = []int{30, 60, 90}

// Pacing gates automatic trials via suspicion meter and post-trial cooldown.
type Pacing struct {
	mu            sync.Mutex
	meter         int
	firedLevels   map[int]bool
	cooldownUntil time.Time
	cooldown      time.Duration
}

func NewPacing(cooldown time.Duration) *Pacing {
	return &Pacing{
		firedLevels: make(map[int]bool),
		cooldown:    cooldown,
	}
}

// Add banks points; holds at 99 while court is busy
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

// Force opens gate immediately for manual starts and platinum donations
func (p *Pacing) Force(now time.Time) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.meter = 0
	p.firedLevels = make(map[int]bool)
	p.cooldownUntil = now.Add(p.cooldown)
}

func (p *Pacing) MarkTrial(now time.Time) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.meter = 0
	p.firedLevels = make(map[int]bool)
	p.cooldownUntil = now.Add(p.cooldown)
}

func (p *Pacing) Ready(now time.Time) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return !now.Before(p.cooldownUntil)
}

func (p *Pacing) Meter() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.meter
}
