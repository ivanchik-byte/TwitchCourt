package bot

import (
	"bufio"
	"context"
	"crypto/tls"
	"fmt"
	"log"
	"net"
	"strings"
	"time"
)

type ChatCommand struct {
	Author   string
	Kind     string
	Argument string
}

const (
	CommandChat     = "chat"
	CommandSue      = "sue"
	CommandGuilty   = "guilty"
	CommandInnocent = "innocent"
	CommandCrime    = "crime"
)

func ParseChatLine(author, text string) ChatCommand {
	trimmed := strings.TrimSpace(text)
	lower := strings.ToLower(trimmed)
	switch {
	case lower == "!sue":
		return ChatCommand{Author: author, Kind: CommandSue}
	case lower == "!guilty":
		return ChatCommand{Author: author, Kind: CommandGuilty}
	case lower == "!innocent":
		return ChatCommand{Author: author, Kind: CommandInnocent}
	case strings.HasPrefix(lower, "!crime"):
		return ChatCommand{Author: author, Kind: CommandCrime, Argument: strings.TrimSpace(trimmed[len("!crime"):])}
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
}

func NewTwitchIRC(channel, nick, token string, emit func(ChatCommand)) *TwitchIRC {
	return &TwitchIRC{
		channel: strings.ToLower(strings.TrimPrefix(channel, "#")),
		nick:    nick,
		token:   token,
		emit:    emit,
		sendCh:  make(chan string, 16),
	}
}

func (t *TwitchIRC) SendMessage(text string) {
	select {
	case t.sendCh <- text:
	default:
	}
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
			continue
		}
		t.emit(ParseChatLine(author, message))
	}
	return scanner.Err()
}

func (t *TwitchIRC) sendLoop(ctx context.Context, done <-chan struct{}, conn net.Conn) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-done:
			return
		case text, ok := <-t.sendCh:
			if !ok {
				return
			}
			fmt.Fprintf(conn, "PRIVMSG #%s :%s\r\n", t.channel, text)
			time.Sleep(1200 * time.Millisecond)
		}
	}
}
