package memory

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

type TrialRecord struct {
	At        time.Time `json:"at"`
	Defendant string    `json:"defendant"`
	Crime     string    `json:"crime"`
	Verdict   string    `json:"verdict"`
	Guilty    int       `json:"guilty"`
	Innocent  int       `json:"innocent"`
	Witnesses int       `json:"witnesses,omitempty"`
	Summary   string    `json:"summary,omitempty"`
}

type DonationRecord struct {
	At       time.Time `json:"at"`
	Donor    string    `json:"donor"`
	Amount   float64   `json:"amount"`
	Currency string    `json:"currency,omitempty"`
	Message  string    `json:"message"`
}

type Participant struct {
	Name       string    `json:"name"`
	SueCalls   int       `json:"sue_calls"`
	Votes      int       `json:"votes"`
	Donated    float64   `json:"donated"`
	LastSeenAt time.Time `json:"last_seen_at"`
}

type Comment struct {
	At     time.Time `json:"at"`
	Author string    `json:"author"`
	Text   string    `json:"text"`
}

type StreamerProfile struct {
	Name        string   `json:"name"`
	Titles      []string `json:"titles,omitempty"`
	Traits      []string `json:"traits,omitempty"`
	RunningGags []string `json:"running_gags,omitempty"`
	Mercy       string   `json:"mercy,omitempty"`
	AutoNotes   []string `json:"auto_notes,omitempty"`
}

const (
	maxTrials       = 50
	maxDonations    = 100
	maxParticipants = 200
	maxComments     = 30
	maxAutoNotes    = 20
)

type Store struct {
	path         string
	mu           sync.RWMutex
	trials       []TrialRecord
	donations    []DonationRecord
	participants map[string]*Participant
	comments     []Comment
	transcript   []string
	profile      StreamerProfile
	usedCases    []string
	saveMu       sync.Mutex
	saveTimer    *time.Timer
}

func NewStore(path string) *Store {
	s := &Store{path: path, participants: make(map[string]*Participant)}
	s.load()
	if s.participants == nil {
		s.participants = make(map[string]*Participant)
	}
	return s
}

func (s *Store) AddTrial(r TrialRecord) {
	if r.At.IsZero() {
		r.At = time.Now()
	}
	s.mu.Lock()
	s.trials = append(s.trials, r)
	if len(s.trials) > maxTrials {
		s.trials = s.trials[len(s.trials)-maxTrials:]
	}
	s.mu.Unlock()
	s.saveSoon()
}

func (s *Store) AddDonation(d DonationRecord) {
	if d.At.IsZero() {
		d.At = time.Now()
	}
	s.mu.Lock()
	s.donations = append(s.donations, d)
	if len(s.donations) > maxDonations {
		s.donations = s.donations[len(s.donations)-maxDonations:]
	}
	if d.Donor != "" {
		p := s.participantLocked(d.Donor)
		p.Donated += d.Amount
		p.LastSeenAt = d.At
	}
	s.mu.Unlock()
	s.saveSoon()
}

func (s *Store) AddComment(author, text string) {
	if text == "" {
		return
	}
	now := time.Now()
	s.mu.Lock()
	s.comments = append(s.comments, Comment{At: now, Author: author, Text: text})
	if len(s.comments) > maxComments {
		s.comments = s.comments[len(s.comments)-maxComments:]
	}
	if author != "" {
		p := s.participantLocked(author)
		p.LastSeenAt = now
	}
	s.mu.Unlock()
	s.saveSoon()
}

func (s *Store) AddSueCall(author string) {
	if author == "" {
		return
	}
	s.mu.Lock()
	p := s.participantLocked(author)
	p.SueCalls++
	p.LastSeenAt = time.Now()
	s.mu.Unlock()
	s.saveSoon()
}

func (s *Store) AddVote(voter string) {
	if voter == "" {
		return
	}
	s.mu.Lock()
	p := s.participantLocked(voter)
	p.Votes++
	p.LastSeenAt = time.Now()
	s.mu.Unlock()
	s.saveSoon()
}

func (s *Store) AddSpeechLine(text string) {
	if text == "" {
		return
	}
	s.mu.Lock()
	s.transcript = append(s.transcript, text)
	if len(s.transcript) > maxComments {
		s.transcript = s.transcript[len(s.transcript)-maxComments:]
	}
	s.mu.Unlock()
}

func (s *Store) ClearTranscript() {
	s.mu.Lock()
	s.transcript = nil
	s.mu.Unlock()
}

func (s *Store) participantLocked(name string) *Participant {
	p, ok := s.participants[name]
	if !ok {
		if len(s.participants) >= maxParticipants {
			oldest := ""
			var oldestAt time.Time
			first := true
			for k, v := range s.participants {
				if first || v.LastSeenAt.Before(oldestAt) {
					oldest, oldestAt, first = k, v.LastSeenAt, false
				}
			}
			if oldest != "" {
				delete(s.participants, oldest)
			}
		}
		p = &Participant{Name: name}
		s.participants[name] = p
	}
	return p
}

func (s *Store) GetProfile() StreamerProfile {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.profile
}

func (s *Store) SetProfile(p StreamerProfile) {
	s.mu.Lock()
	auto := s.profile.AutoNotes
	s.profile = p
	s.profile.AutoNotes = auto
	s.mu.Unlock()
	s.saveSoon()
}

func (s *Store) NoteForAI(note string) {
	if note == "" {
		return
	}
	s.mu.Lock()
	s.profile.AutoNotes = append(s.profile.AutoNotes, note)
	if len(s.profile.AutoNotes) > maxAutoNotes {
		s.profile.AutoNotes = s.profile.AutoNotes[len(s.profile.AutoNotes)-maxAutoNotes:]
	}
	s.mu.Unlock()
	s.saveSoon()
}

func (s *Store) RecentTrials(n int) []TrialRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if n <= 0 || n > len(s.trials) {
		n = len(s.trials)
	}
	out := make([]TrialRecord, n)
	copy(out, s.trials[len(s.trials)-n:])
	return out
}

func (s *Store) OffenderCount(defendant string) int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	count := 0
	for _, t := range s.trials {
		if t.Defendant == defendant {
			count++
		}
	}
	return count
}

func (s *Store) RecentDonations(n int) []DonationRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if n <= 0 || n > len(s.donations) {
		n = len(s.donations)
	}
	out := make([]DonationRecord, n)
	copy(out, s.donations[len(s.donations)-n:])
	return out
}

func (s *Store) TopAccusers(n int) []Participant {
	s.mu.RLock()
	defer s.mu.RUnlock()
	best := make([]Participant, 0, len(s.participants))
	for _, p := range s.participants {
		if p.SueCalls > 0 || p.Votes > 2 {
			best = append(best, *p)
		}
	}
	sort.Slice(best, func(i, j int) bool {
		if best[i].SueCalls != best[j].SueCalls {
			return best[i].SueCalls > best[j].SueCalls
		}
		return best[i].Votes > best[j].Votes
	})
	if n > 0 && len(best) > n {
		best = best[:n]
	}
	return best
}

func (s *Store) RecentComments(n int) []Comment {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if n <= 0 || n > len(s.comments) {
		n = len(s.comments)
	}
	out := make([]Comment, n)
	copy(out, s.comments[len(s.comments)-n:])
	return out
}

// MarkCaseUsed records a played case id (deck no-repeat survives restarts).
func (s *Store) MarkCaseUsed(id string) {
	if id == "" {
		return
	}
	s.mu.Lock()
	for _, have := range s.usedCases {
		if have == id {
			s.mu.Unlock()
			return
		}
	}
	s.usedCases = append(s.usedCases, id)
	s.mu.Unlock()
	s.saveSoon()
}

// UsedCases snapshots played case ids.
func (s *Store) UsedCases() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return append([]string(nil), s.usedCases...)
}

// ResetUsedCases clears played case ids.
func (s *Store) ResetUsedCases() {
	s.mu.Lock()
	s.usedCases = nil
	s.mu.Unlock()
	s.saveSoon()
}

// UnmarkCaseUsed returns one case id to the unplayed pile.
func (s *Store) UnmarkCaseUsed(id string) {
	s.mu.Lock()
	kept := s.usedCases[:0]
	for _, have := range s.usedCases {
		if have != id {
			kept = append(kept, have)
		}
	}
	s.usedCases = kept
	s.mu.Unlock()
	s.saveSoon()
}

// saveSoon throttles writes to at most one disk flush per second
func (s *Store) saveSoon() {
	if s.path == "" {
		return
	}
	s.saveMu.Lock()
	defer s.saveMu.Unlock()
	if s.saveTimer != nil {
		return
	}
	s.saveTimer = time.AfterFunc(time.Second, func() {
		s.saveMu.Lock()
		s.saveTimer = nil
		s.saveMu.Unlock()
		s.save()
	})
}

// Flush flushes pending throttled memory writes to disk immediately.
func (s *Store) Flush() {
	if s.path == "" {
		return
	}
	s.saveMu.Lock()
	if s.saveTimer != nil {
		s.saveTimer.Stop()
		s.saveTimer = nil
	}
	s.saveMu.Unlock()
	s.save()
}

func (s *Store) load() {
	if s.path == "" {
		return
	}
	raw, err := os.ReadFile(s.path)
	if err != nil {
		return
	}
	var dump struct {
		Trials       []TrialRecord           `json:"trials"`
		Donations    []DonationRecord        `json:"donations"`
		Participants map[string]*Participant `json:"participants"`
		Profile      StreamerProfile         `json:"profile"`
		UsedCases    []string                `json:"used_cases"`
		Comments     []Comment               `json:"comments"`
	}
	if err := json.Unmarshal(raw, &dump); err != nil {
		_ = os.WriteFile(s.path+".bak", raw, 0o600)
		return
	}
	s.trials = dump.Trials
	s.donations = dump.Donations
	s.participants = dump.Participants
	s.profile = dump.Profile
	s.usedCases = dump.UsedCases
	s.comments = dump.Comments
}

func (s *Store) save() {
	if s.path == "" {
		return
	}
	// Serialize whole dumps: concurrent saves share one tmp path.
	s.saveMu.Lock()
	defer s.saveMu.Unlock()
	// Snapshot under read lock so Marshal never races with AddTrial/AddDonation.
	s.mu.RLock()
	trials := make([]TrialRecord, len(s.trials))
	copy(trials, s.trials)
	donations := make([]DonationRecord, len(s.donations))
	copy(donations, s.donations)
	participants := make(map[string]*Participant, len(s.participants))
	for k, v := range s.participants {
		cp := *v
		participants[k] = &cp
	}
	profile := s.profile
	profile.Titles = append([]string(nil), s.profile.Titles...)
	profile.Traits = append([]string(nil), s.profile.Traits...)
	profile.RunningGags = append([]string(nil), s.profile.RunningGags...)
	profile.AutoNotes = append([]string(nil), s.profile.AutoNotes...)
	usedCases := append([]string(nil), s.usedCases...)
	comments := make([]Comment, len(s.comments))
	copy(comments, s.comments)
	s.mu.RUnlock()
	dump := map[string]any{
		"trials":       trials,
		"donations":    donations,
		"participants": participants,
		"profile":      profile,
		"used_cases":   usedCases,
		"comments":     comments,
	}
	raw, err := json.MarshalIndent(dump, "", "  ")
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(s.path), 0o755)
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return
	}
	_ = os.Rename(tmp, s.path)
}
