package main

import (
	"encoding/json"
	"math"
	"net/http"
	"strings"
	"sync"
	"time"

	"stream-tribunal/internal/bot"
	"stream-tribunal/internal/config"
	"stream-tribunal/internal/court"
	"stream-tribunal/internal/memory"
	"stream-tribunal/internal/obs"
	"stream-tribunal/internal/safety"
)

type donationPlan struct {
	Action      string `json:"action"`
	Note        string `json:"note"`
	QueueNick   string `json:"queue_nick,omitempty"`
	QueueReason string `json:"queue_reason,omitempty"`
}

func planDonation(cfg *config.Config, d bot.Donation, phase court.State, demo bool) donationPlan {
	if demo {
		return donationPlan{Action: "rehearsal", Note: "Идёт репетиция. Донат не меняет учебное дело."}
	}
	code := strings.ToUpper(strings.TrimSpace(d.Currency))
	ruleCode := cfg.Donations.RuleCurrency
	if ruleCode == "" {
		ruleCode = "RUB"
	}
	sameCurrency := code == ruleCode
	words := strings.Fields(d.Message)
	if sameCurrency && cfg.Donations.QueueMin > 0 && d.Amount >= cfg.Donations.QueueMin && len(words) > 0 && strings.EqualFold(words[0], "!court") {
		if !cfg.Courtroom.QueueOpen {
			return donationPlan{Action: "queue_closed", Note: "Очередь закрыта ведущим. Участник не добавлен."}
		}
		if len(words) < 2 || !validNick.MatchString(strings.TrimPrefix(words[1], "@")) {
			return donationPlan{Action: "invalid_nick", Note: "После !court нужен Twitch-ник: !court username причина."}
		}
		return donationPlan{Action: "queue", Note: "Приоритетный вход в очередь. Дело начнёт ведущий.", QueueNick: strings.TrimPrefix(words[1], "@"), QueueReason: strings.Join(words[2:], " ")}
	}
	if phase == court.StateIdle {
		if sameCurrency && ((cfg.Donations.StreamerTrialMin > 0 && d.Amount >= cfg.Donations.StreamerTrialMin) || (cfg.Donations.PlatinumMin > 0 && d.Amount >= cfg.Donations.PlatinumMin)) {
			return donationPlan{Action: "trial", Note: "Открытие суда над стримером, если ИИ настроен и зал свободен."}
		}
		return donationPlan{Action: "support", Note: "Сейчас нет активного дела. Донат учтён без запуска суда."}
	}
	if !bot.NewGate(cfg.Donations.MinAmounts, cfg.Donations.DefaultMin).Pass(bot.DonationEvent{Amount: d.Amount, Currency: code}) {
		return donationPlan{Action: "below_minimum", Note: "Сумма ниже порога участия в суде."}
	}
	if phase == court.StateDeliberation || phase == court.StateVerdict {
		return donationPlan{Action: "too_late", Note: "Суд уже совещается или огласил решение. Новые показания не меняют это дело."}
	}
	amount := d.Amount
	if !sameCurrency {
		amount = 0
	}
	if isBribe(cfg, amount, d.Message) {
		return donationPlan{Action: "bribe", Note: "Попытка подкупа передана судье. Принять или отвергнуть решает ИИ."}
	}
	if !cfg.Donations.WitnessEnabled {
		return donationPlan{Action: "support", Note: "Донат учтён. Приобщение обычных донатов к делу выключено."}
	}
	return donationPlan{Action: "witness", Note: "Сообщение приобщено как показание по текущему делу."}
}

type donationDesk struct {
	currentConfig func() *config.Config
	engine        *court.Engine
	recall        *memory.Store
	hub           *obs.Hub
	filter        *safety.Filter
	open          func(string, string, string) bool
	mu            sync.RWMutex
	nextID        uint64
	journal       []obs.DonationPayload
}

func (desk *donationDesk) receive(d bot.Donation) {
	if d.Amount <= 0 || math.IsNaN(d.Amount) || math.IsInf(d.Amount, 0) {
		return
	}
	cfg := desk.currentConfig()
	d.Donor = desk.filter.Sanitize(truncateRunes(d.Donor, 64))
	if d.Donor == "" {
		d.Donor = "Аноним"
	}
	flagged := safety.Banned(d.Message)
	d.Message = desk.filter.Sanitize(truncateRunes(d.Message, 500))
	d.Currency = strings.ToUpper(strings.TrimSpace(truncateRunes(d.Currency, 16)))
	view := desk.engine.Snapshot()
	plan := planDonation(cfg, d, court.State(view.State), view.Demo)
	if !view.Demo {
		desk.recall.AddDonation(memory.DonationRecord{Donor: d.Donor, Amount: d.Amount, Currency: d.Currency, Message: d.Message})
	}
	opened := false
	switch plan.Action {
	case "queue":
		joined, position := desk.engine.JoinPriorityPool(plan.QueueNick, plan.QueueReason)
		if !joined && position == 0 {
			plan.Action, plan.Note = "queue_full", "Очередь заполнена или закрыта. Участник не добавлен."
		} else if !joined {
			plan.Note = "Участник уже находится в приоритетной очереди."
		}
	case "bribe", "witness":
		var accepted bool
		if flagged {
			accepted = desk.engine.AddFlaggedWitness(d.Donor, d.Amount, d.Currency, d.Message)
		} else {
			accepted = desk.engine.AddWitness(d.Donor, d.Amount, d.Currency, d.Message)
		}
		if !accepted {
			plan.Action, plan.Note = "too_late", "Этап уже сменился. Сообщение не приобщено к делу."
		} else if plan.Action == "bribe" && !desk.engine.AddBribe(d.Donor, d.Amount, d.Currency, d.Message) {
			plan.Action, plan.Note = "witness", "Показание приобщено. Попытка подкупа повторяется или достигнут лимит."
		}
	case "trial":
		opened = openDonationTrial(cfg, desk.open, d.Donor, d.Amount, d.Currency, d.Message)
		if !opened {
			plan.Action, plan.Note = "not_started", "Суд не открыт. Проверьте подключение ИИ и состояние зала."
		}
	}
	receipt := obs.DonationPayload{Donor: d.Donor, Amount: d.Amount, Currency: d.Currency, Message: d.Message, OpensTrial: opened, Action: plan.Action, Note: plan.Note, At: time.Now().UTC().Format(time.RFC3339)}
	desk.mu.Lock()
	desk.nextID++
	receipt.ID = desk.nextID
	desk.journal = append(desk.journal, receipt)
	if len(desk.journal) > 50 {
		desk.journal = desk.journal[len(desk.journal)-50:]
	}
	desk.mu.Unlock()
	desk.hub.BroadcastEvent(obs.EventDonation, receipt)
}

func registerDonationDesk(mux *http.ServeMux, desk *donationDesk) {
	mux.HandleFunc("/api/donations", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", 405)
			return
		}
		if !checkHTTPAuth(desk.currentConfig(), r) {
			http.Error(w, "unauthorized", 401)
			return
		}
		desk.mu.RLock()
		receipts := append([]obs.DonationPayload{}, desk.journal...)
		desk.mu.RUnlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"donations": receipts})
	})
	mux.HandleFunc("/api/donations/preview", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", 405)
			return
		}
		if !checkHTTPAuth(desk.currentConfig(), r) {
			http.Error(w, "unauthorized", 401)
			return
		}
		var req struct {
			Donor    string      `json:"donor"`
			Amount   float64     `json:"amount"`
			Currency string      `json:"currency"`
			Message  string      `json:"message"`
			Phase    court.State `json:"phase"`
		}
		if err := decodeJSON(w, r, &req); err != nil || req.Amount <= 0 || len(req.Message) > 2000 {
			http.Error(w, "bad request", 400)
			return
		}
		switch req.Phase {
		case court.StateIdle, court.StateIndictment, court.StateTestimony, court.StateDefense, court.StateObjection, court.StateDeliberation, court.StateVerdict:
		default:
			http.Error(w, "unknown phase", 400)
			return
		}
		plan := planDonation(desk.currentConfig(), bot.Donation{Donor: req.Donor, Amount: req.Amount, Currency: req.Currency, Message: req.Message}, req.Phase, false)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(plan)
	})
}
