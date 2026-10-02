package safety

import (
	"strings"
	"testing"
	"time"
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

// banned replacement words must terminate instead of looping forever
func TestFilterSelfTrigger(t *testing.T) {
	done := make(chan string, 1)
	go func() {
		filter := NewFilter([]string{"банан", "сыр", "пирожок", "крендель", "цензура"})
		done <- filter.Sanitize("съел банан и сыр с цензурой")
	}()
	select {
	case got := <-done:
		lowered := strings.ToLower(got)
		for _, banned := range []string{"банан", "сыр"} {
			if strings.Contains(lowered, banned) {
				t.Fatalf("banned word leaked: %q", got)
			}
		}
	case <-time.After(5 * time.Second):
		t.Fatal("sanitize hung on self-triggering replacement")
	}
}
