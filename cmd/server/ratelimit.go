package main

import (
	"sync"
	"time"
)

type actionLimiter struct {
	mu       sync.Mutex
	interval time.Duration
	last     map[string]time.Time
}

func newActionLimiter(interval time.Duration) *actionLimiter {
	return &actionLimiter{interval: interval, last: make(map[string]time.Time)}
}

func (l *actionLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	if t, ok := l.last[key]; ok && now.Sub(t) < l.interval {
		return false
	}
	l.last[key] = now
	if len(l.last) > 4096 {
		cutoff := now.Add(-l.interval * 10)
		for k, t := range l.last {
			if t.Before(cutoff) {
				delete(l.last, k)
			}
		}
		if len(l.last) > 4096 {
			l.last[key] = now
			for k := range l.last {
				if k != key {
					delete(l.last, k)
					if len(l.last) <= 4096 {
						break
					}
				}
			}
		}
	}
	return true
}
