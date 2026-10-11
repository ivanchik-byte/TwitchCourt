package ai

import "strings"

// ParseVerdict scans the whole ruling for the guilt keyword;
// НЕВИНОВЕН wins on precedence wherever it stands.
func ParseVerdict(text string) (guilty, decided bool) {
	s := strings.ToUpper(strings.TrimSpace(text))
	switch {
	case strings.Contains(s, "НЕВИНОВЕН"):
		return false, true
	case strings.Contains(s, "ВИНОВЕН"):
		return true, true
	default:
		return false, false
	}
}
