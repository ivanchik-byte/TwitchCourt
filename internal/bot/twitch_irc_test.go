package bot

import (
	"testing"
	"time"
)

func TestParseChatLine(t *testing.T) {
	cases := []struct {
		author string
		text   string
		kind   string
		arg    string
	}{
		{"ivan", "!sue", CommandSue, ""},
		{"ivan", "!SUE", CommandSue, ""},
		{"ivan", "!guilty", CommandGuilty, ""},
		{"ivan", "!innocent", CommandInnocent, ""},
		{"ivan", "!crime украл алмазы", CommandCrime, "украл алмазы"},
		{"ivan", "просто коммент", CommandChat, "просто коммент"},
	}
	for _, c := range cases {
		got := ParseChatLine(c.author, c.text)
		if got.Kind != c.kind || got.Argument != c.arg || got.Author != c.author {
			t.Fatalf("ParseChatLine(%q) = %+v, want kind %q arg %q", c.text, got, c.kind, c.arg)
		}
	}
}

func TestParsePrivMsg(t *testing.T) {
	plain := ":ivan!ivan@ivan.tmi.twitch.tv PRIVMSG #channel :!sue"
	author, msg, ok := parsePrivMsg(plain)
	if !ok || author != "ivan" || msg != "!sue" {
		t.Fatalf("plain failed: %q %q %v", author, msg, ok)
	}

	tagged := "@badge-info=;badges=broadcaster/1;color=#FF0000 :maria!maria@maria.tmi.twitch.tv PRIVMSG #channel :Привет суд"
	author, msg, ok = parsePrivMsg(tagged)
	if !ok || author != "maria" || msg != "Привет суд" {
		t.Fatalf("tagged failed: %q %q %v", author, msg, ok)
	}

	if _, _, ok := parsePrivMsg("PING :tmi.twitch.tv"); ok {
		t.Fatal("PING must not parse as privmsg")
	}
}

func TestSueTracker(t *testing.T) {
	base := time.Now()
	tr := NewSueTracker(3, time.Minute, 5*time.Minute)
	if tr.Hit(base) || tr.Hit(base.Add(10*time.Second)) {
		t.Fatal("must not fire before threshold")
	}
	if !tr.Hit(base.Add(20 * time.Second)) {
		t.Fatal("must fire on third call in window")
	}
	if tr.Hit(base.Add(30 * time.Second)) {
		t.Fatal("cooldown must block right after trial")
	}
	late := base.Add(6 * time.Minute)
	if tr.Hit(late) || tr.Hit(late.Add(10*time.Second)) {
		t.Fatal("fresh window needs 3 calls")
	}
	if !tr.Hit(late.Add(20 * time.Second)) {
		t.Fatal("must fire on third fresh call")
	}
}
