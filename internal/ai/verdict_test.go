package ai

import "testing"

func TestParseVerdict(t *testing.T) {
	cases := []struct {
		in      string
		guilty  bool
		decided bool
	}{
		{"ВИНОВЕН. Суд постановил.", true, true},
		{"НЕВИНОВЕН. Отпустить.", false, true},
		{"Суд постановил: ВИНОВЕН", true, true},
		{"ПОДСУДИМЫЙ НЕВИНОВЕН", false, true},
		{"  виновен, и точка", true, true},
		{"Судья не решился. НЕВИНОВЕН. Суд окончен.", false, true},
		{"Хм-м-м... сложно сказать.", false, false},
		{"", false, false},
		{"Дело слушалось долго и наконец " + "очень-очень долго " + "ВИНОВЕН", false, false},
	}
	for _, c := range cases {
		guilty, decided := ParseVerdict(c.in)
		if guilty != c.guilty || decided != c.decided {
			t.Errorf("ParseVerdict(%q) = (%v, %v), want (%v, %v)",
				c.in, guilty, decided, c.guilty, c.decided)
		}
	}
}
