package bot

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

type Donation struct {
	Donor    string
	Amount   float64
	Currency string
	Message  string
}

type DonationsWatcher struct {
	token string
	emit  func(Donation)
	http  *http.Client
}

func NewDonationsWatcher(token string, emit func(Donation)) *DonationsWatcher {
	return &DonationsWatcher{
		token: token,
		emit:  emit,
		http:  &http.Client{Timeout: 15 * time.Second},
	}
}

var socketURLRe = regexp.MustCompile(`wss://socket\d+\.donationalerts\.(?:ru|com)`)

func (w *DonationsWatcher) Run(ctx context.Context) {
	if w.token == "" {
		return
	}
	backoff := 5 * time.Second
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		if err := w.listen(ctx); err != nil {
			log.Printf("donationalerts: %v", err)
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

func (w *DonationsWatcher) listen(ctx context.Context) error {
	socketURL, err := w.discoverSocketURL(ctx)
	if err != nil {
		return fmt.Errorf("discover socket: %w", err)
	}
	log.Printf("donationalerts: socket at %s", socketURL)

	sid, err := w.handshake(ctx, socketURL)
	if err != nil {
		return fmt.Errorf("handshake: %w", err)
	}

	url := strings.Replace(socketURL, "https://", "wss://", 1)
	url = strings.Replace(url, "http://", "ws://", 1)
	url += "/socket.io/?EIO=3&transport=websocket&sid=" + sid
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, url, nil)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()

	if err := conn.WriteMessage(websocket.TextMessage, []byte("40")); err != nil {
		return err
	}

	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return fmt.Errorf("read: %w", err)
		}
		w.handlePacket(conn, string(raw))
	}
}

func (w *DonationsWatcher) discoverSocketURL(ctx context.Context) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://www.donationalerts.com/widget/alerts?token="+w.token, nil)
	if err != nil {
		return "", err
	}
	resp, err := w.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	if err != nil {
		return "", err
	}
	found := socketURLRe.FindString(string(body))
	if found == "" {
		return "", fmt.Errorf("no socket url on widget page, bad token?")
	}
	return strings.Replace(found, "wss://", "https://", 1), nil
}

func (w *DonationsWatcher) handshake(ctx context.Context, socketURL string) (string, error) {
	url := socketURL + "/socket.io/?EIO=3&transport=polling"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	resp, err := w.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
	if err != nil {
		return "", err
	}
	return parseHandshakeSID(string(body))
}

func parseHandshakeSID(body string) (string, error) {
	rest := body
	for len(rest) > 0 {
		colon := strings.Index(rest, ":")
		if colon < 0 {
			break
		}
		length, err := strconv.Atoi(rest[:colon])
		if err != nil || colon+1+length > len(rest) {
			break
		}
		packet := rest[colon+1 : colon+1+length]
		rest = rest[colon+1+length:]
		if strings.HasPrefix(packet, "0") {
			var open struct {
				SID string `json:"sid"`
			}
			if err := json.Unmarshal([]byte(packet[1:]), &open); err == nil && open.SID != "" {
				return open.SID, nil
			}
		}
	}
	return "", fmt.Errorf("no sid in handshake")
}

func (w *DonationsWatcher) handlePacket(conn *websocket.Conn, packet string) {
	switch {
	case packet == "2":
		_ = conn.WriteMessage(websocket.TextMessage, []byte("3"))
	case strings.HasPrefix(packet, "42"):
		if d, ok := scanDonation([]byte(packet[2:])); ok {
			w.emit(d)
		}
	default:
		log.Printf("donationalerts: packet %.120s", packet)
	}
}

func scanDonation(payload []byte) (Donation, bool) {
	var items []any
	if err := json.Unmarshal(payload, &items); err != nil {
		var single any
		if err := json.Unmarshal(payload, &single); err != nil {
			return Donation{}, false
		}
		items = []any{single}
	}
	for _, item := range items {
		if d, ok := matchDonation(item); ok {
			return d, true
		}
	}
	return Donation{}, false
}

func matchDonation(node any) (Donation, bool) {
	obj, ok := node.(map[string]any)
	if !ok {
		return Donation{}, false
	}
	for _, value := range obj {
		if d, ok := matchDonation(value); ok {
			return d, true
		}
	}
	username, _ := firstString(obj, "username", "name", "donor")
	amount, hasAmount := firstNumber(obj, "amount", "amountMain", "sum")
	if username == "" || !hasAmount {
		return Donation{}, false
	}
	message, _ := firstString(obj, "message", "text")
	currency, _ := firstString(obj, "currency")
	return Donation{Donor: username, Amount: amount, Currency: currency, Message: message}, true
}

func firstString(obj map[string]any, keys ...string) (string, bool) {
	for _, key := range keys {
		if value, ok := obj[key].(string); ok && value != "" {
			return value, true
		}
	}
	return "", false
}

func firstNumber(obj map[string]any, keys ...string) (float64, bool) {
	for _, key := range keys {
		switch value := obj[key].(type) {
		case float64:
			return value, true
		case int:
			return float64(value), true
		case json.Number:
			if parsed, err := value.Float64(); err == nil {
				return parsed, true
			}
		}
	}
	return 0, false
}
