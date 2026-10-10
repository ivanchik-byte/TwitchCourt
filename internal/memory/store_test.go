package memory

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestSpeechLinesStayOutOfChat(t *testing.T) {
	s := NewStore("")
	s.AddComment("ivan", "он точно сам в лаву прыгнул")
	s.AddSpeechLine("Суд слушает дело номер 404!")
	for _, c := range s.RecentComments(10) {
		if c.Author == "прокурор" {
			t.Fatalf("judge speech must not pollute chat buffer: %+v", c)
		}
	}
	s.ClearTranscript()
	if got := len(s.RecentComments(10)); got != 1 {
		t.Fatalf("clearing transcript must keep chat, got %d", got)
	}
}

func TestCommentsPersist(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "memory.json")
	s := NewStore(path)
	s.AddComment("ivan", "he did it")
	s.Flush()
	reloaded := NewStore(path)
	comments := reloaded.RecentComments(10)
	if len(comments) != 1 || comments[0].Author != "ivan" {
		t.Fatalf("comments must survive restart: %+v", comments)
	}
}

func TestOffenderCount(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(filepath.Join(dir, "memory.json"))
	s.AddTrial(TrialRecord{Defendant: "streamer", Crime: "lava", Verdict: "guilty", Guilty: 10, Innocent: 2})
	s.AddTrial(TrialRecord{Defendant: "streamer", Crime: "creeper", Verdict: "innocent", Guilty: 3, Innocent: 9})
	s.AddTrial(TrialRecord{Defendant: "chat", Crime: "spam", Verdict: "guilty"})

	if got := s.OffenderCount("streamer"); got != 2 {
		t.Fatalf("want 2, got %d", got)
	}
	if got := len(s.RecentTrials(2)); got != 2 {
		t.Fatalf("want 2 recent, got %d", got)
	}

	reloaded := func() *Store {
		s.Flush()
		return NewStore(filepath.Join(dir, "memory.json"))
	}()
	if got := reloaded.OffenderCount("streamer"); got != 2 {
		t.Fatalf("persist failed, want 2 got %d", got)
	}
}

func TestSmartContext(t *testing.T) {
	s := NewStore("")
	s.SetProfile(StreamerProfile{Name: "Стример", Traits: []string{"жадный до алмазов"}, RunningGags: []string{"лава"}})
	s.AddTrial(TrialRecord{Defendant: "Стример", Crime: "лава", Verdict: "ВИНОВЕН", Guilty: 8, Innocent: 2})
	s.AddSueCall("заводила")
	s.AddVote("заводила")
	s.AddDonation(DonationRecord{Donor: "меценат", Amount: 600, Message: "отмажь его"})
	ctx := s.SmartContext("Стример")
	for _, want := range []string{"Стример", "Рецидив", "заводила", "меценат"} {
		if !strings.Contains(ctx, want) {
			t.Fatalf("context missing %q:\n%s", want, ctx)
		}
	}
}
