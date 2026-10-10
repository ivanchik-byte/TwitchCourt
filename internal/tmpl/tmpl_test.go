package tmpl

import "testing"

func TestFillSubstitutes(t *testing.T) {
	got := Fill("мут на {secs} секунд", map[string]string{"secs": "90"})
	if got != "мут на 90 секунд" {
		t.Fatalf("bad fill: %q", got)
	}
}

func TestFillEmptyStaysSilent(t *testing.T) {
	if got := Fill("", map[string]string{"donor": "ivan", "amount": "150"}); got != "" {
		t.Fatalf("empty template must render nothing, got %q", got)
	}
	if got := Fill("  ", nil); got != "" {
		t.Fatalf("blank template must render nothing, got %q", got)
	}
}

func TestFillMissingKeyLeftAlone(t *testing.T) {
	got := Fill("дело {crime}", map[string]string{"other": "x"})
	if got != "дело {crime}" {
		t.Fatalf("missing keys must stay visible for debugging, got %q", got)
	}
}
