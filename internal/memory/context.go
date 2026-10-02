package memory

import "fmt"
import "strings"

// SmartContext renders a <=12 line summary for the LLM prompt
func (s *Store) SmartContext(defendant string) string {
	var parts []string

	if p := s.GetProfile(); p.Name != "" || len(p.Traits) > 0 || len(p.RunningGags) > 0 {
		var bits []string
		if p.Name != "" {
			bits = append(bits, p.Name)
		}
		if len(p.Titles) > 0 {
			bits = append(bits, strings.Join(p.Titles, ", "))
		}
		if len(p.Traits) > 0 {
			bits = append(bits, "черты: "+strings.Join(p.Traits, ", "))
		}
		if len(p.RunningGags) > 0 {
			bits = append(bits, "мемы: "+strings.Join(p.RunningGags, ", "))
		}
		if p.Mercy != "" {
			bits = append(bits, "строгость: "+p.Mercy)
		}
		for _, note := range p.AutoNotes {
			bits = append(bits, "замечено: "+note)
		}
		parts = append(parts, "Стример: "+strings.Join(bits, "; ")+".")
	}

	if streak := s.streakLocked(); streak != "" {
		parts = append(parts, streak)
	}

	count := s.OffenderCount(defendant)
	if count > 0 {
		recent := s.RecentTrials(5)
		last := ""
		for i := len(recent) - 1; i >= 0; i-- {
			if recent[i].Defendant == defendant {
				last = fmt.Sprintf("%s (%d-%d)", recent[i].Verdict, recent[i].Guilty, recent[i].Innocent)
				break
			}
		}
		if count == 1 {
			parts = append(parts, fmt.Sprintf("Рецидив: уже 2-й суд, прошлый вердикт %s.", last))
		} else {
			parts = append(parts, fmt.Sprintf("Рецидивист: %d прошлых судов, последний %s.", count, last))
		}
	}

	for _, p := range s.TopAccusers(3) {
		parts = append(parts, fmt.Sprintf("Заводила %s: !sue %d, голосов %d.", p.Name, p.SueCalls, p.Votes))
	}

	for _, d := range s.RecentDonations(2) {
		name := d.Donor
		if name == "" {
			name = "Аноним"
		}
		line := fmt.Sprintf("Донат %.0fр от %s", d.Amount, flatten(name))
		if d.Message != "" {
			msg := flatten(d.Message)
			if len([]rune(msg)) > 80 {
				msg = string([]rune(msg)[:80]) + "..."
			}
			line += ": «" + msg + "»"
		}
		parts = append(parts, "[сообщение зрителя] "+line)
	}

	for _, c := range s.RecentComments(4) {
		author := c.Author
		if author == "" {
			author = "чат"
		}
		text := flatten(c.Text)
		if len([]rune(text)) > 120 {
			text = string([]rune(text)[:120]) + "..."
		}
		parts = append(parts, fmt.Sprintf("[реплика] %s: %s", flatten(author), text))
	}

	out := strings.Join(parts, "\n")
	if len([]rune(out)) > 1500 {
		out = string([]rune(out)[:1500]) + "..."
	}
	return out
}

func flatten(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

func (s *Store) streakLocked() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if len(s.trials) < 2 {
		return ""
	}
	last := s.trials[len(s.trials)-1].Verdict
	run := 0
	for i := len(s.trials) - 1; i >= 0; i-- {
		if s.trials[i].Verdict != last {
			break
		}
		run++
	}
	if run >= 2 {
		return fmt.Sprintf("Серия: %s %d суда подряд.", last, run)
	}
	return ""
}
