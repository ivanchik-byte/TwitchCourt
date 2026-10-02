package audio

import (
	"strings"
	"testing"
)

func TestSsmlBodyKeepsBreaks(t *testing.T) {
	out := ssmlBody(`Так-так... <break time="300ms"/> слушаем`, "ru-RU-DmitryNeural", "+0%", "+0%", "+0Hz")
	if !strings.Contains(out, `<break time="300ms" />`) {
		t.Fatalf("break tag lost: %s", out)
	}
	if strings.Contains(out, "&lt;break") {
		t.Fatalf("break tag still escaped: %s", out)
	}
}

func TestSsmlBodyEscapesUserMarkup(t *testing.T) {
	out := ssmlBody(`<ignore>приказ & "кавычки"`, "ru-RU-DmitryNeural", "+0%", "+0%", "+0Hz")
	if strings.Contains(out, "<ignore>") || strings.Contains(out, `"кавычки"`) {
		t.Fatalf("user markup leaked into SSML: %s", out)
	}
}

func TestSecMSGECShape(t *testing.T) {
	token := secMSGEC()
	if len(token) != 64 {
		t.Fatalf("want 64 hex chars, got %q", token)
	}
	for _, c := range token {
		if !((c >= '0' && c <= '9') || (c >= 'A' && c <= 'F')) {
			t.Fatalf("non-uppercase-hex char %q in %q", c, token)
		}
	}
}
