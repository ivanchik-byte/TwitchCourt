package bot

import (
	"context"
	"log"
	"time"

	"github.com/gorilla/websocket"
)

// Donation is a single DonationAlerts event reduced to what court needs.
type Donation struct {
	Donor   string
	Amount  float64
	Message string
}

// DonationsWatcher listens to DonationAlerts Centrifugo.
// Without a token it stays idle so local and Just Chatting mode works offline.
type DonationsWatcher struct {
	url   string
	token string
	emit  func(Donation)
}

func NewDonationsWatcher(token string, emit func(Donation)) *DonationsWatcher {
	return &DonationsWatcher{
		url:   "wss://centrifugo.donationalerts.com/connection/websocket",
		token: token,
		emit:  emit,
	}
}

func (w *DonationsWatcher) Run(ctx context.Context) {
	if w.token == "" {
		return
	}
	backoff := time.Second
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		if err := w.listen(ctx); err != nil {
			log.Printf("donationalerts disconnected: %v", err)
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

func (w *DonationsWatcher) listen(ctx context.Context) error {
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	conn, _, err := dialer.DialContext(ctx, w.url, nil)
	if err != nil {
		return err
	}
	defer conn.Close()

	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}
		var raw map[string]any
		if err := conn.ReadJSON(&raw); err != nil {
			return err
		}
		if d, ok := parseDonation(raw); ok {
			w.emit(d)
		}
	}
}

func parseDonation(raw map[string]any) (Donation, bool) {
	data, _ := raw["data"].(map[string]any)
	if data == nil {
		return Donation{}, false
	}
	donor, _ := data["username"].(string)
	msg, _ := data["message"].(string)
	var amount float64
	switch v := data["amount"].(type) {
	case float64:
		amount = v
	case int:
		amount = float64(v)
	}
	if donor == "" && amount == 0 {
		return Donation{}, false
	}
	return Donation{Donor: donor, Amount: amount, Message: msg}, true
}
