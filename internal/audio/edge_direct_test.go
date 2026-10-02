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

func TestLivelyMarks(t *testing.T) {
	shout := ssmlBody(`Протестую!`, "ru-RU-DmitryNeural", "+0%", "+0%", "+0Hz")
	if !strings.Contains(shout, `'+10%'`) || !strings.Contains(shout, `'+5Hz'`) {
		t.Fatalf("shout not lifted: %s", shout)
	}
	flat := ssmlBody(`Суд слушает дело.`, "ru-RU-DmitryNeural", "+0%", "+0%", "+0Hz")
	if !strings.Contains(flat, `'+0%'`) || !strings.Contains(flat, `'+0Hz'`) {
		t.Fatalf("plain line must keep base profile: %s", flat)
	}
}

func TestShiftHelpers(t *testing.T) {
	if got := shiftRate("+15%", 10); got != "+25%" {
		t.Fatalf("rate: %s", got)
	}
	if got := shiftPitch("-10Hz", 5); got != "-5Hz" {
		t.Fatalf("pitch: %s", got)
	}
}
