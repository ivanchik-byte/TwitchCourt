package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"stream-tribunal/internal/bot"
	"stream-tribunal/internal/config"
	"stream-tribunal/internal/court"
	"stream-tribunal/internal/memory"
	"stream-tribunal/internal/obs"
	"stream-tribunal/internal/safety"
)

func TestDonationRouting(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Donations.BribeMin, cfg.Donations.QueueMin = 400, 200
	cfg.Safety.BribeWords = []string{"взятк"}
	for _, tc := range []struct {
		name, currency, message string
		amount                  float64
		phase                   court.State
		demo                    bool
		want                    string
	}{
		{"regular testimony", "RUB", "Есть улика", 100, court.StateTestimony, false, "witness"},
		{"jury closes materials", "RUB", "Есть улика", 100, court.StateJury, false, "too_late"},
		{"below minimum", "RUB", "взятка", 99, court.StateTestimony, false, "below_minimum"},
		{"bribe by words", "USD", "это ВЗЯТКА", 2, court.StateDefense, false, "bribe"},
		{"bribe by amount", "RUB", "на чай", 400, court.StateDefense, false, "bribe"},
		{"currency is not converted", "USD", "на чай", 400, court.StateDefense, false, "witness"},
		{"open court", "RUB", "суд над стримером", 500, court.StateIdle, false, "trial"},
		{"bits cannot buy ruble action", "BITS", "суд", 500, court.StateIdle, false, "support"},
		{"priority entry", "RUB", "!court @viewer_123 причина", 200, court.StateDefense, false, "queue"},
		{"invalid login", "RUB", "!court плохой_ник", 200, court.StateIdle, false, "invalid_nick"},
		{"after verdict", "RUB", "взятка", 1000, court.StateVerdict, false, "too_late"},
		{"rehearsal isolation", "RUB", "!court viewer", 1000, court.StateTestimony, true, "rehearsal"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			plan := planDonation(cfg, bot.Donation{Amount: tc.amount, Currency: tc.currency, Message: tc.message}, tc.phase, tc.demo)
			if plan.Action != tc.want {
				t.Fatalf("want %s, got %+v", tc.want, plan)
			}
		})
	}
	cfg.Courtroom.QueueOpen = false
	if plan := planDonation(cfg, bot.Donation{Amount: 500, Currency: "RUB", Message: "!court viewer"}, court.StateIdle, false); plan.Action != "queue_closed" {
		t.Fatal(plan)
	}
	cfg.Donations.WitnessEnabled = false
	if plan := planDonation(cfg, bot.Donation{Amount: 100, Currency: "RUB", Message: "hi"}, court.StateDefense, false); plan.Action != "support" {
		t.Fatal(plan)
	}
}

func TestDonationPreviewCannotApplyEffects(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Donations.QueueMin = 200
	engine := court.NewEngine(cfg, obs.NewHub(nil), nil, nil, safety.NewFilter(nil))
	desk := &donationDesk{currentConfig: func() *config.Config { return cfg }, engine: engine}
	mux := http.NewServeMux()
	registerDonationDesk(mux, desk)
	for _, body := range []string{`{"amount":200,"currency":"RUB","message":"!court viewer","phase":"idle"}`, `{"amount":500,"currency":"RUB","message":"суд","phase":"idle"}`} {
		request := httptest.NewRequest(http.MethodPost, "/api/donations/preview", strings.NewReader(body))
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, request)
		if response.Code != 200 {
			t.Fatal(response.Code, response.Body.String())
		}
	}
	if len(engine.PoolList()) != 0 || engine.GetState() != court.StateIdle || len(desk.journal) != 0 {
		t.Fatal("preview had a live effect")
	}
}

func TestDonationReceiptReflectsActualRouting(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Donations.QueueMin = 200
	filter := safety.NewFilter(nil)
	engine := court.NewEngine(cfg, obs.NewHub(nil), nil, nil, filter)
	desk := &donationDesk{currentConfig: func() *config.Config { return cfg }, engine: engine, hub: obs.NewHub(nil), filter: filter, recall: memory.NewStore(""), open: func(string, string, string) bool { return false }}
	desk.receive(bot.Donation{Donor: "donor", Amount: 200, Currency: "RUB", Message: "!court viewer причина"})
	if seats := engine.PoolList(); len(seats) != 1 || seats[0].Nick != "viewer" || !seats[0].Priority {
		t.Fatal(seats)
	}
	if desk.journal[0].OpensTrial || desk.journal[0].Action != "queue" {
		t.Fatal("queue entry reported as a started court")
	}
	desk.receive(bot.Donation{Donor: "donor", Amount: 500, Currency: "RUB", Message: "суд"})
	if last := desk.journal[1]; last.OpensTrial || last.Action != "not_started" {
		t.Fatal("failed start reported as successful", last)
	}
}
