package ai

import "strings"

// ParseVerdict scans leading runes for guilt keyword; treats НЕВИНОВЕН with precedence.
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
