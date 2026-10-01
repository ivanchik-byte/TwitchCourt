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

func TestPending(t *testing.T) {
	var p Pending
	if _, ok := p.Pop(); ok {
		t.Fatal("empty pending must pop nothing")
	}
	p.Push(DonationEvent{Donor: "a", Amount: 100})
	p.Push(DonationEvent{Donor: "b", Amount: 200})
	got, ok := p.Pop()
	if !ok || got.Donor != "b" {
		t.Fatalf("latest must win, got %+v", got)
	}
	if _, ok := p.Pop(); ok {
		t.Fatal("queue holds one slot only")
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
