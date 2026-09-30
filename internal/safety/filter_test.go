package safety

import (
	"strings"
	"testing"
)

func TestFilterSanitize(t *testing.T) {
	blacklist := []string{"запрещенка", "чит"}
	filter := NewFilter(blacklist)

	raw := "<script>alert('xss')</script>"
	clean := filter.Sanitize(raw)
	if strings.Contains(clean, "<script>") {
		t.Errorf("expected script tags to be escaped, got %s", clean)
	}

	rawToxic := "Этот игрок использует чит и запрещенка"
	cleanToxic := filter.Sanitize(rawToxic)
	if strings.Contains(cleanToxic, "чит") || strings.Contains(cleanToxic, "запрещенка") {
		t.Errorf("expected blacklisted words replaced, got %s", cleanToxic)
	}

	cleanNormal := filter.Sanitize("Обычное нормальное сообщение")
	if cleanNormal != "Обычное нормальное сообщение" {
		t.Errorf("expected unchanged message, got %s", cleanNormal)
	}
}
