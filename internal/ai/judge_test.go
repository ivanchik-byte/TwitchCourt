package ai

import (
	"strings"
	"testing"
)

func TestJudgeStyles(t *testing.T) {
	for _, style := range []string{"strict", "cynical", "unknown"} {
		j := JudgeFor(style)
		if j.Name == "" || j.System == "" {
			t.Fatalf("judge style %q has empty fields", style)
		}
		if !strings.Contains(j.System, "35 слов") {
			t.Fatalf("judge style %q misses brevity cap", style)
		}
		if strings.Contains(j.System, "ProsodyDirection") {
			t.Fatalf("judge style %q leaks Go code into prompt", style)
		}
		if !strings.Contains(j.System, "АУДИО-РЕЖИССУРА") {
			t.Fatalf("judge style %q misses prosody direction", style)
		}
	}
	if got := JudgeFor("whatever"); got.Name != "strict" {
		t.Fatalf("unknown style must fall back to strict, got %q", got.Name)
	}
}
