package tmpl

import "testing"

func TestFillSubstitutes(t *testing.T) {
	got := Fill("мут на {secs} секунд", map[string]string{"secs": "90"})
	if got != "мут на 90 секунд" {
		t.Fatalf("bad fill: %q", got)
	}
}

func TestFillEmptyStaysPlain(t *testing.T) {
	got := Fill("", map[string]string{"donor": "ivan", "amount": "150"})
	if got != "150 ivan" {
		t.Fatalf("empty template must join values, got %q", got)
	}
	if Fill("", map[string]string{"a": "", "b": " "}) != "" {
		t.Fatal("empty values must render nothing")
	}
}
