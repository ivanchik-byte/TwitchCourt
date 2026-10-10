package bot

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

// EventSubWatcher listens to bits cheers (requires bits:read scope)
type EventSubWatcher struct {
	token         string
	clientID      string
	broadcasterID string
	emit          func(DonationEvent)
	http          *http.Client
	seen          map[string]time.Time
}

func NewEventSubWatcher(token, clientID, broadcasterID string, emit func(DonationEvent)) *EventSubWatcher {
	return &EventSubWatcher{
		token:         token,
		clientID:      clientID,
		broadcasterID: broadcasterID,
		emit:          emit,
		http:          &http.Client{Timeout: 10 * time.Second},
		seen:          make(map[string]time.Time),
	}
}

func (w *EventSubWatcher) Run(ctx context.Context) {
	if w.token == "" || w.clientID == "" || w.broadcasterID == "" {
		return
	}
	url := "wss://eventsub.wss.twitch.tv/ws"
	backoff := 5 * time.Second
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		if err := w.listen(ctx, url); err != nil {
			var re *reconnectError
			if errors.As(err, &re) {
				url = re.url
				log.Printf("eventsub: reconnecting to new session")
				continue
			}
			log.Printf("eventsub error: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff *= 2
		if backoff > time.Minute {
			backoff = time.Minute
		}
	}
}

type eventsubEnvelope struct {
	Metadata struct {
		MessageID   string `json:"message_id"`
		MessageType string `json:"message_type"`
	} `json:"metadata"`
	Payload json.RawMessage `json:"payload"`
}

type reconnectError struct{ url string }

func (e *reconnectError) Error() string { return "eventsub reconnect to " + e.url }

func (w *EventSubWatcher) listen(ctx context.Context, url string) error {
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, url, nil)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()

	_, raw, err := conn.ReadMessage()
	if err != nil {
		return fmt.Errorf("welcome: %w", err)
	}
	sessionID, err := parseSessionWelcome(raw)
	if err != nil {
		return err
	}
	if err := w.subscribe(ctx, sessionID); err != nil {
		return fmt.Errorf("subscribe: %w", err)
	}
	log.Printf("eventsub: subscribed to channel.cheer")

	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return err
		}
		if url := w.handleMessage(raw); url != "" {
			return &reconnectError{url: url}
		}
	}
}

func parseSessionWelcome(raw []byte) (string, error) {
	var env eventsubEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return "", err
	}
	if env.Metadata.MessageType != "session_welcome" {
		return "", fmt.Errorf("want session_welcome, got %q", env.Metadata.MessageType)
	}
	var payload struct {
		Session struct {
			ID string `json:"id"`
		} `json:"session"`
	}
	if err := json.Unmarshal(env.Payload, &payload); err != nil || payload.Session.ID == "" {
		return "", fmt.Errorf("no session id")
	}
	return payload.Session.ID, nil
}

func (w *EventSubWatcher) handleMessage(raw []byte) string {
	var env eventsubEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return ""
	}
	switch env.Metadata.MessageType {
	case "notification":
		if w.duplicate(env.Metadata.MessageID) {
			return ""
		}
		if event, ok := parseCheerEvent(env.Payload); ok {
			w.emit(event)
		}
	case "session_reconnect":
		if url := parseReconnectURL(env.Payload); url != "" {
			return url
		}
		log.Printf("eventsub: server asked to reconnect")
	}
	return ""
}

func parseReconnectURL(payload []byte) string {
	var msg struct {
		Session struct {
			ReconnectURL string `json:"reconnect_url"`
		} `json:"session"`
	}
	if err := json.Unmarshal(payload, &msg); err != nil {
		return ""
	}
	return msg.Session.ReconnectURL
}

func (w *EventSubWatcher) duplicate(id string) bool {
	if id == "" {
		return false
	}
	now := time.Now()
	if seen, ok := w.seen[id]; ok && now.Sub(seen) < 10*time.Minute {
		return true
	}
	w.seen[id] = now
	if len(w.seen) > 500 {
		w.seen = make(map[string]time.Time)
	}
	return false
}

func parseCheerEvent(payload []byte) (DonationEvent, bool) {
	var note struct {
		Subscription struct {
			Type string `json:"type"`
		} `json:"subscription"`
		Event struct {
			UserName string `json:"user_name"`
			Bits     int    `json:"bits"`
			Message  string `json:"message"`
		} `json:"event"`
	}
	if err := json.Unmarshal(payload, &note); err != nil {
		return DonationEvent{}, false
	}
	if note.Subscription.Type != "channel.cheer" || note.Event.Bits <= 0 {
		return DonationEvent{}, false
	}
	donor := note.Event.UserName
	if donor == "" {
		donor = "Аноним"
	}
	return DonationEvent{
		Donor:    donor,
		Amount:   float64(note.Event.Bits),
		Currency: "BITS",
		Message:  note.Event.Message,
	}, true
}

func (w *EventSubWatcher) subscribe(ctx context.Context, sessionID string) error {
	body, _ := json.Marshal(map[string]any{
		"type":    "channel.cheer",
		"version": "1",
		"condition": map[string]string{
			"broadcaster_user_id": w.broadcasterID,
		},
		"transport": map[string]string{
			"method":     "websocket",
			"session_id": sessionID,
		},
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.twitch.tv/helix/eventsub/subscriptions", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+w.token)
	req.Header.Set("Client-Id", w.clientID)
	req.Header.Set("Content-Type", "application/json")
	resp, err := w.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("helix status %d", resp.StatusCode)
	}
	return nil
}
