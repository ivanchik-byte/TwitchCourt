package court

import (
	"sort"
	"strings"
	"sync"
	"time"
)

type sueVote struct {
	reason string
	at     time.Time
}

// SueTracker counts unique !sue authors inside a sliding window.
// The streamer configures how many people trigger a streamer trial.
type SueTracker struct {
	mu    sync.Mutex
	votes map[string]sueVote
}

func NewSueTracker() *SueTracker {
	return &SueTracker{votes: make(map[string]sueVote)}
}

// Add records one author's reason, drops votes older than window,
// and returns the current unique-author count.
func (s *SueTracker) Add(author, reason string, now time.Time, window time.Duration) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.votes == nil {
		s.votes = make(map[string]sueVote)
	}
	for a, v := range s.votes {
		if now.Sub(v.at) > window {
			delete(s.votes, a)
		}
	}
	s.votes[author] = sueVote{reason: strings.TrimSpace(reason), at: now}
	return len(s.votes)
}

func (s *SueTracker) Count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.votes)
}

func (s *SueTracker) Reset() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.votes = make(map[string]sueVote)
}

// TopReason picks the crowd's charge: most-voted reason wins,
// ties go to the longest one, empty reasons are skipped.
func (s *SueTracker) TopReason() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	freq := make(map[string]int)
	for _, v := range s.votes {
		if v.reason != "" {
			freq[v.reason]++
		}
	}
	if len(freq) == 0 {
		return "чат требует суда над стримером"
	}
	type scored struct {
		reason string
		n      int
	}
	all := make([]scored, 0, len(freq))
	for reason, n := range freq {
		all = append(all, scored{reason, n})
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].n != all[j].n {
			return all[i].n > all[j].n
		}
		return len(all[i].reason) > len(all[j].reason)
	})
	return all[0].reason
}
