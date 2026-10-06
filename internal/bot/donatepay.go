package bot

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

// DonatePayWatcher subscribes to donatepay donation events via Centrifugo.
type DonatePayWatcher struct {
	apiKey string
	emit   func(Donation)
	http   *http.Client
	msgID  int64
}

func NewDonatePayWatcher(apiKey string, emit func(Donation)) *DonatePayWatcher {
	return &DonatePayWatcher{
		apiKey: apiKey,
		emit:   emit,
		http:   &http.Client{Timeout: 10 * time.Second},
	}
}

func (w *DonatePayWatcher) Run(ctx context.Context) {
	if w.apiKey == "" {
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
			log.Printf("donatepay error: %v", err)
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

func (w *DonatePayWatcher) listen(ctx context.Context) error {
	userID, err := w.fetchUserID(ctx)
	if err != nil {
		return fmt.Errorf("fetch user id: %w", err)
	}
	socketToken, err := w.fetchSocketToken(ctx)
	if err != nil {
		return fmt.Errorf("fetch socket token: %w", err)
	}

	conn, _, err := websocket.DefaultDialer.DialContext(ctx, "wss://centrifugo.donatepay.ru/connection/websocket", nil)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()

	if err := conn.WriteJSON(map[string]any{
		"params": map[string]any{"token": socketToken, "name": "go"},
		"id":     atomic.AddInt64(&w.msgID, 1),
	}); err != nil {
		return err
	}
	channel := fmt.Sprintf("notifications#%d", userID)
	if err := conn.WriteJSON(map[string]any{
		"method": 1,
		"params": map[string]any{"channel": channel},
		"id":     atomic.AddInt64(&w.msgID, 1),
	}); err != nil {
		return err
	}
	log.Printf("donatepay: subscribed to %s", channel)

	pingTicker := time.NewTicker(25 * time.Second)
	defer pingTicker.Stop()
	done := make(chan struct{})
	defer close(done)
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-done:
				return
			case <-pingTicker.C:
				_ = conn.WriteJSON(map[string]any{
					"method": 7,
					"id":     atomic.AddInt64(&w.msgID, 1),
				})
			}
		}
	}()

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
		w.handleMessage(raw)
	}
}

func (w *DonatePayWatcher) handleMessage(raw []byte) {
	var resp struct {
		Result struct {
			Data struct {
				Notification struct {
					Type string          `json:"type"`
					Vars json.RawMessage `json:"vars"`
				} `json:"notification"`
				Transaction struct {
					Currency string `json:"currency"`
				} `json:"transaction"`
			} `json:"data"`
		} `json:"result"`
	}
	if err := json.Unmarshal(raw, &resp); err != nil {
		return
	}
	if resp.Result.Data.Notification.Type != "donation" {
		return
	}

	// vars arrives either as an object or as a JSON-encoded string.
	varsBytes := resp.Result.Data.Notification.Vars
	if len(varsBytes) > 0 && varsBytes[0] == '"' {
		var unquoted string
		if err := json.Unmarshal(varsBytes, &unquoted); err == nil {
			varsBytes = []byte(unquoted)
		}
	}
	var vars struct {
		Name    string `json:"name"`
		Sum     any    `json:"sum"`
		Comment string `json:"comment"`
	}
	if err := json.Unmarshal(varsBytes, &vars); err != nil {
		return
	}

	currency := resp.Result.Data.Transaction.Currency
	if currency == "" {
		currency = "RUB"
	}
	donor := vars.Name
	if donor == "" {
		donor = "Аноним"
	}
	w.emit(Donation{
		Donor:    donor,
		Amount:   parseDonatePayAmount(vars.Sum),
		Currency: currency,
		Message:  vars.Comment,
	})
}

func (w *DonatePayWatcher) fetchUserID(ctx context.Context) (int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://donatepay.ru/api/v1/user?access_token="+w.apiKey, nil)
	if err != nil {
		return 0, err
	}
	resp, err := w.http.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	var res struct {
		Status string `json:"status"`
		Data   struct {
			ID int `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil || res.Status != "success" {
		return 0, fmt.Errorf("bad user response")
	}
	return res.Data.ID, nil
}

func (w *DonatePayWatcher) fetchSocketToken(ctx context.Context) (string, error) {
	payload, _ := json.Marshal(map[string]string{"access_token": w.apiKey})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://donatepay.ru/api/v2/socket/token", bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := w.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var res struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil || res.Token == "" {
		return "", fmt.Errorf("bad socket token response")
	}
	return res.Token, nil
}

func parseDonatePayAmount(value any) float64 {
	switch parsed := value.(type) {
	case float64:
		return parsed
	case int:
		return float64(parsed)
	case string:
		amount, _ := strconv.ParseFloat(parsed, 64)
		return amount
	default:
		return 0
	}
}
