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

func TestFilterToggleEnabled(t *testing.T) {
	filter := NewFilter([]string{"чит"})
	if filter.Sanitize("игрок юзает чит") == "игрок юзает чит" {
		t.Fatal("expected sanitized text when filter enabled")
	}

	filter.SetEnabled(false)
	raw := "игрок юзает чит & <b>bold</b>"
	got := filter.Sanitize(raw)
	if !strings.Contains(got, "чит") {
		t.Fatalf("expected blacklisted word to remain when disabled, got %s", got)
	}
	if strings.Contains(got, "<b>") {
		t.Fatalf("expected HTML to be escaped even when disabled, got %s", got)
	}
}

func TestFilterSetBlacklist(t *testing.T) {
	filter := NewFilter([]string{"слово1"})
	if !strings.Contains(filter.Sanitize("тут слово1"), "[банан]") {
		t.Fatalf("expected слово1 to be replaced")
	}

	filter.SetBlacklist([]string{"новоеслово"})
	if strings.Contains(filter.Sanitize("тут слово1"), "[банан]") {
		t.Fatalf("слово1 should no longer be blacklisted after SetBlacklist")
	}
	if !strings.Contains(filter.Sanitize("тут новоеслово"), "[банан]") {
		t.Fatalf("новоеслово should be blacklisted after SetBlacklist")
	}
}

func TestFilterSpecialCharacters(t *testing.T) {
	filter := NewFilter([]string{"bad+word*", "[test]?"})
	got := filter.Sanitize("here is bad+word* and [test]?")
	if strings.Contains(got, "bad+word*") || strings.Contains(got, "[test]?") {
		t.Fatalf("special characters should be safely escaped and matched, got %s", got)
	}
}

