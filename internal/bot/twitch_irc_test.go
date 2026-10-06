package bot

import (
	"testing"
)

func TestParseChatLine(t *testing.T) {
	cases := []struct {
		author string
		text   string
		kind   string
		arg    string
	}{
		{"ivan", "!crime украл алмазы", CommandCrime, "украл алмазы"},
		{"ivan", "!court", CommandCourt, ""},
		{"ivan", "!court смотрю с работы", CommandCourt, "смотрю с работы"},
		{"ivan", "!sue слив катки", CommandSue, "слив катки"},
		{"ivan", "!sue", CommandSue, ""},
		{"ivan", "!leave", CommandLeave, ""},
		{"ivan", "!snitch он сидит на другом стриме", CommandSnitch, "он сидит на другом стриме"},
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

func TestTimeoutCommand(t *testing.T) {
	irc := NewTwitchIRC("channel", "bot", "token", func(ChatCommand) {})
	irc.Timeout("troll", 90)
	select {
	case msg := <-irc.modCh:
		if msg != "/timeout troll 90" {
			t.Fatalf("bad timeout command: %q", msg)
		}
	default:
		t.Fatal("timeout must queue a message")
	}
	irc.Ban("troll")
	select {
	case msg := <-irc.modCh:
		if msg != "/ban troll" {
			t.Fatalf("bad ban command: %q", msg)
		}
	default:
		t.Fatal("ban must queue a message")
	}
}

func TestChatMessageQueue(t *testing.T) {
	irc := NewTwitchIRC("channel", "bot", "token", func(ChatCommand) {})
	irc.SendMessage("hello chat")
	select {
	case msg := <-irc.sendCh:
		if msg != "hello chat" {
			t.Fatalf("bad chat message: %q", msg)
		}
	default:
		t.Fatal("chat must queue a message")
	}
}

func TestModErrorTracking(t *testing.T) {
	irc := NewTwitchIRC("channel", "bot", "token", func(ChatCommand) {})
	if _, bad := irc.LastModError(); bad {
		t.Fatal("fresh client must be clean")
	}
	irc.noteModError("@msg-id=timeout_no_permission :tmi.twitch.tv NOTICE #channel :You don't have permission to timeout users.")
	got, bad := irc.LastModError()
	if !bad || got == "" {
		t.Fatal("refusal must be remembered")
	}
	irc.noteModError(":someone!someone@host PRIVMSG #channel :hello")
	if _, bad := irc.LastModError(); !bad {
		t.Fatal("chat lines must not clear the refusal")
	}
}
