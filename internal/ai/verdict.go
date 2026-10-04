package ai

import "strings"

// ParseVerdict reads the bench ruling: the model must start with
// either ВИНОВЕН or НЕВИНОВЕН, but soft-heads add preamble, so scan
// the first 40 runes. НЕВИНОВЕН wins over its own substring.
func ParseVerdict(text string) (guilty, decided bool) {
	head := []rune(strings.ToUpper(strings.TrimSpace(text)))
	if len(head) > 40 {
		head = head[:40]
	}
	s := string(head)
	switch {
	case strings.Contains(s, "НЕВИНОВЕН"):
		return false, true
	case strings.Contains(s, "ВИНОВЕН"):
		return true, true
	default:
		return false, false
	}
}
