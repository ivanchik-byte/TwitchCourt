package court

import (
	"testing"
	"time"
)

func TestSueTrackerThreshold(t *testing.T) {
	s := NewSueTracker()
	now := time.Now()
	if n := s.Add("a", "слив", now, time.Hour); n != 1 {
		t.Fatalf("got %d, want 1", n)
	}
	s.Add("a", "токсичность", now, time.Hour)
	if n := s.Count(); n != 1 {
		t.Fatalf("same author must not double count, got %d", n)
	}
	s.Add("b", "слив", now, time.Hour)
	s.Add("c", "слив", now, time.Hour)
	if got := s.TopReason(); got != "слив" {
		t.Fatalf("top reason = %q, want слив", got)
	}
}

func TestSueTrackerWindowExpiry(t *testing.T) {
	s := NewSueTracker()
	old := time.Now().Add(-2 * time.Hour)
	s.Add("a", "x", old, time.Hour)
	if n := s.Add("b", "y", time.Now(), time.Hour); n != 1 {
		t.Fatalf("expired vote must drop, count = %d", n)
	}
}

func TestSueTrackerEmptyReasons(t *testing.T) {
	s := NewSueTracker()
	s.Add("a", "", time.Now(), time.Hour)
	if got := s.TopReason(); got == "" {
		t.Fatal("empty reasons must fall back to a default charge")
	}
}
