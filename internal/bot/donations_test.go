package bot

import (
	"strconv"
	"testing"
)

func itoa(n int) string { return strconv.Itoa(n) }

func TestGate(t *testing.T) {
	open := NewGate(nil, 0)
	if !open.Pass(DonationEvent{Amount: 1, Currency: "RUB"}) {
		t.Fatal("empty gate must pass everything")
	}

	gate := NewGate(map[string]float64{"RUB": 100, "USD": 5}, 10)
	if !gate.Pass(DonationEvent{Amount: 150, Currency: "RUB"}) {
		t.Fatal("150 RUB must pass")
	}
	if gate.Pass(DonationEvent{Amount: 50, Currency: "RUB"}) {
		t.Fatal("50 RUB must not pass")
	}
	if !gate.Pass(DonationEvent{Amount: 5, Currency: "usd"}) {
		t.Fatal("currency match must be case-insensitive")
	}
	if gate.Pass(DonationEvent{Amount: 9, Currency: "EUR"}) {
		t.Fatal("unknown currency must use fallback 10")
	}
	if !gate.Pass(DonationEvent{Amount: 10, Currency: "EUR"}) {
		t.Fatal("fallback boundary must pass")
	}
}

func TestDeck(t *testing.T) {
	empty := NewDeck(nil)
	if got := empty.Draw(); got != "" {
		t.Fatalf("empty deck must draw nothing, got %q", got)
	}

	single := NewDeck([]string{"  ", "присесть 10 раз"})
	if got := single.Draw(); got != "присесть 10 раз" {
		t.Fatalf("single deck must draw it, got %q", got)
	}

	seen := map[string]bool{}
	deck := NewDeck([]string{"a", "b", "c"})
	for i := 0; i < 60; i++ {
		seen[deck.Draw()] = true
	}
	if len(seen) < 2 {
		t.Fatal("draw must vary across 60 picks")
	}
}

func TestParseHandshakeSID(t *testing.T) {
	open := `0{"sid":"abc123","upgrades":["websocket"],"pingInterval":25000,"pingTimeout":5000}`
	body := itoa(len(open)) + ":" + open + "2:40"
	sid, err := parseHandshakeSID(body)
	if err != nil || sid != "abc123" {
		t.Fatalf("want abc123, got %q %v", sid, err)
	}
	if _, err := parseHandshakeSID(`2:40`); err == nil {
		t.Fatal("must fail without open packet")
	}
}

func TestScanDonation(t *testing.T) {
	payload := []byte(`["donation",{"username":"ivan","amount":250,"currency":"RUB","message":"накинь статью"}]`)
	d, ok := scanDonation(payload)
	if !ok {
		t.Fatal("must match donation shape")
	}
	if d.Donor != "ivan" || d.Amount != 250 || d.Currency != "RUB" || d.Message != "накинь статью" {
		t.Fatalf("bad fields: %+v", d)
	}
	if _, ok := scanDonation([]byte(`["ping",{}]`)); ok {
		t.Fatal("must not match noise")
	}
}

func TestDonatePayMessage(t *testing.T) {
	raw := []byte(`{"result":{"channel":"notifications#123","data":{"notification":{"type":"donation","vars":{"name":"Зритель_777","sum":250,"comment":"Он прыгнул в лаву!"}},"transaction":{"currency":"RUB"}}}}`)
	var got *Donation
	w := NewDonatePayWatcher("key", func(d Donation) { got = &d })
	w.handleMessage(raw)
	if got == nil {
		t.Fatal("must emit donation")
	}
	if got.Donor != "Зритель_777" || got.Amount != 250 || got.Currency != "RUB" || got.Message != "Он прыгнул в лаву!" {
		t.Fatalf("bad fields: %+v", got)
	}

	strVars := []byte(`{"result":{"data":{"notification":{"type":"donation","vars":"{\"name\":\"Анон\",\"sum\":\"99.5\",\"comment\":\"hi\"}"},"transaction":{}}}}`)
	got = nil
	w.handleMessage(strVars)
	if got == nil || got.Donor != "Анон" || got.Amount != 99.5 || got.Currency != "RUB" {
		t.Fatalf("string vars must parse with RUB default: %+v", got)
	}

	got = nil
	w.handleMessage([]byte(`{"result":{"data":{"notification":{"type":"media"},"transaction":{}}}}`))
	if got != nil {
		t.Fatal("non-donation must not emit")
	}
}

func TestParseSessionWelcome(t *testing.T) {
	raw := []byte(`{"metadata":{"message_id":"m1","message_type":"session_welcome"},"payload":{"session":{"id":"sess42","status":"connected"}}}`)
	id, err := parseSessionWelcome(raw)
	if err != nil || id != "sess42" {
		t.Fatalf("want sess42, got %q %v", id, err)
	}
	if _, err := parseSessionWelcome([]byte(`{"metadata":{"message_type":"notification"}}`)); err == nil {
		t.Fatal("must reject non-welcome")
	}
}

func TestParseCheerEvent(t *testing.T) {
	raw := []byte(`{"subscription":{"type":"channel.cheer"},"event":{"user_name":"ivan","bits":300,"message":"Суди его!"}}`)
	event, ok := parseCheerEvent(raw)
	if !ok {
		t.Fatal("must parse cheer")
	}
	if event.Donor != "ivan" || event.Amount != 300 || event.Currency != "BITS" || event.Message != "Суди его!" {
		t.Fatalf("bad fields: %+v", event)
	}
	if _, ok := parseCheerEvent([]byte(`{"subscription":{"type":"channel.follow"},"event":{}}`)); ok {
		t.Fatal("must ignore other types")
	}
}
