package bot

import (
	"bufio"
	"context"
	"crypto/tls"
	"fmt"
	"log"
	"net"
	"strings"
	"sync"
	"time"
)

type ChatCommand struct {
	Author   string
	Kind     string
	Argument string
}

const (
	CommandChat   = "chat"
	CommandCrime  = "crime"
	CommandSnitch = "snitch"
	CommandCourt  = "court"
	CommandSue    = "sue"
	CommandLeave  = "leave"
)

func ParseChatLine(author, text string) ChatCommand {
	trimmed := strings.TrimSpace(text)
	lower := strings.ToLower(trimmed)
	switch {
	case strings.HasPrefix(lower, "!crime"):
		return ChatCommand{Author: author, Kind: CommandCrime, Argument: strings.TrimSpace(trimmed[len("!crime"):])}
	case strings.HasPrefix(lower, "!snitch"):
		return ChatCommand{Author: author, Kind: CommandSnitch, Argument: strings.TrimSpace(trimmed[len("!snitch"):])}
	case strings.HasPrefix(lower, "!court"):
		return ChatCommand{Author: author, Kind: CommandCourt, Argument: strings.TrimSpace(trimmed[len("!court"):])}
	case strings.HasPrefix(lower, "!sue"):
		return ChatCommand{Author: author, Kind: CommandSue, Argument: strings.TrimSpace(trimmed[len("!sue"):])}
	case lower == "!leave":
		return ChatCommand{Author: author, Kind: CommandLeave}
	default:
		return ChatCommand{Author: author, Kind: CommandChat, Argument: trimmed}
	}
}

func parsePrivMsg(line string) (author, message string, ok bool) {
	rest := line
	if strings.HasPrefix(rest, "@") {
		idx := strings.Index(rest, " ")
		if idx < 0 {
			return "", "", false
		}
		rest = rest[idx+1:]
	}
	if !strings.HasPrefix(rest, ":") {
		return "", "", false
	}
	rest = rest[1:]
	bang := strings.Index(rest, "!")
	if bang < 0 {
		return "", "", false
	}
	author = rest[:bang]
	privIdx := strings.Index(rest, "PRIVMSG")
	if privIdx < 0 {
		return "", "", false
	}
	msgIdx := strings.Index(rest[privIdx:], " :")
	if msgIdx < 0 {
		return "", "", false
	}
	message = rest[privIdx+msgIdx+2:]
	return author, message, true
}

type TwitchIRC struct {
	channel string
	nick    string
	token   string
	emit    func(ChatCommand)
	sendCh  chan string
	modCh   chan string

	modMu    sync.RWMutex
	modError string

	dropMu   sync.Mutex
	dropChat int
	dropMod  int
}

func NewTwitchIRC(channel, nick, token string, emit func(ChatCommand)) *TwitchIRC {
	return &TwitchIRC{
		channel: strings.ToLower(strings.TrimPrefix(channel, "#")),
		nick:    nick,
		token:   token,
		emit:    emit,
		sendCh:  make(chan string, 16),
		modCh:   make(chan string, 64),
	}
}

func (t *TwitchIRC) SendMessage(text string) {
	select {
	case t.sendCh <- text:
	default:
		t.dropMu.Lock()
		t.dropChat++
		n := t.dropChat
		t.dropMu.Unlock()
		log.Printf("twitch irc chat queue full, dropped message #%d", n)
	}
}

func (t *TwitchIRC) sendMod(text string) {
	select {
	case t.modCh <- text:
	default:
		t.dropMu.Lock()
		t.dropMod++
		n := t.dropMod
		t.dropMu.Unlock()
		log.Printf("twitch irc mod queue full, DROPPED punishment #%d: %s", n, text)
	}
}

// Timeout puts a user into chat jail; the bot must moderate the channel
func (t *TwitchIRC) Timeout(user string, secs int) {
	t.sendMod(fmt.Sprintf("/timeout %s %d", user, secs))
}

// Ban removes a user from chat for good; the bot must moderate the channel
func (t *TwitchIRC) Ban(user string) {
	t.sendMod(fmt.Sprintf("/ban %s", user))
}

// LastModError reports the latest moderation refusal from Twitch, if any
func (t *TwitchIRC) LastModError() (string, bool) {
	t.modMu.RLock()
	defer t.modMu.RUnlock()
	if t.modError == "" {
		return "", false
	}
	return t.modError, true
}

// noteModError tracks moderation failures for dashboard warnings
func (t *TwitchIRC) noteModError(line string) {
	if !strings.Contains(line, "NOTICE") {
		return
	}
	lower := strings.ToLower(line)
	switch {
	case strings.Contains(lower, "permission"),
		strings.Contains(lower, "moderator"),
		strings.Contains(lower, "not sent"),
		strings.Contains(lower, "suspended"),
		strings.Contains(lower, "banned"):
	default:
		return
	}
	text := line
	if i := strings.LastIndex(line, " :"); i >= 0 {
		text = line[i+2:]
	}
	t.modMu.Lock()
	t.modError = strings.TrimSpace(text)
	t.modMu.Unlock()
	log.Printf("twitch moderation refused: %s", t.modError)
}

func (t *TwitchIRC) Run(ctx context.Context) {
	if t.token == "" || t.channel == "" {
		return
	}
	backoff := time.Second
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		if err := t.listen(ctx); err != nil {
			log.Printf("twitch irc disconnected: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff *= 2
		if backoff > 30*time.Second {
			backoff = 30 * time.Second
		}
	}
}

func (t *TwitchIRC) listen(ctx context.Context) error {
	dialer := net.Dialer{Timeout: 10 * time.Second}
	raw, err := dialer.DialContext(ctx, "tcp", "irc.chat.twitch.tv:6697")
	if err != nil {
		return err
	}
	conn := tls.Client(raw, &tls.Config{ServerName: "irc.chat.twitch.tv"})
	if err := conn.HandshakeContext(ctx); err != nil {
		raw.Close()
		return err
	}
	defer conn.Close()

	fmt.Fprintf(conn, "PASS %s\r\nNICK %s\r\nJOIN #%s\r\n", t.token, t.nick, t.channel)

	done := make(chan struct{})
	defer close(done)
	go t.sendLoop(ctx, done, conn)

	scanner := bufio.NewScanner(conn)
	scanner.Buffer(make([]byte, 64*1024), 512*1024)
	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return nil
		default:
		}
		line := scanner.Text()
		if strings.HasPrefix(line, "PING") {
			fmt.Fprintf(conn, "PONG%s\r\n", line[4:])
			continue
		}
		author, message, ok := parsePrivMsg(line)
		if !ok {
			t.noteModError(line)
			continue
		}
		t.emit(ParseChatLine(author, message))
	}
	return scanner.Err()
}

func (t *TwitchIRC) sendLoop(ctx context.Context, done <-chan struct{}, conn net.Conn) {
	send := func(text string) {
		fmt.Fprintf(conn, "PRIVMSG #%s :%s\r\n", t.channel, text)
		time.Sleep(1200 * time.Millisecond)
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-done:
			return
		case text := <-t.modCh:
			send(text)
		default:
			select {
			case <-ctx.Done():
				return
			case <-done:
				return
			case text := <-t.modCh:
				send(text)
			case text, ok := <-t.sendCh:
				if !ok {
					return
				}
				send(text)
			}
		}
	}
}
