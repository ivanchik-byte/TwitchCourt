package main

import (
	"regexp"
	"strconv"
	"strings"

	"stream-tribunal/internal/config"
	"stream-tribunal/internal/tmpl"
)

// validNick validates Twitch username format.
var validNick = regexp.MustCompile(`^[A-Za-z0-9_]{3,25}$`)

// isBribe checks if a donation qualifies as a bribe attempt.
func isBribe(cfg *config.Config, amount float64, message string) bool {
	lower := strings.ToLower(message)
	for _, w := range cfg.Safety.BribeWords {
		word := strings.TrimSpace(strings.ToLower(w))
		if word != "" && strings.Contains(lower, word) {
			return true
		}
	}
	return cfg.Donations.BribeMin > 0 && amount >= cfg.Donations.BribeMin
}

func openDonationTrial(cfg *config.Config, open func(defendant, crime, context string) bool, donor string, amount float64, currency, message string) bool {
	msg := strings.TrimSpace(message)
	vars := map[string]string{"message": msg}
	crime := tmpl.Fill(cfg.Chat.DonateCrime, vars)
	context := tmpl.Fill(cfg.Chat.DonateContext, map[string]string{
		"donor":    donor,
		"amount":   strconv.FormatFloat(amount, 'f', -1, 64),
		"currency": currency,
	})
	switch {
	case cfg.Donations.StreamerTrialMin > 0 && amount >= cfg.Donations.StreamerTrialMin,
		cfg.Donations.PlatinumMin > 0 && amount >= cfg.Donations.PlatinumMin:
		if crime == "" {
			crime = tmpl.Fill(cfg.Chat.DonateStreamer, vars)
		}
		if crime == "" {
			crime = tmpl.Fill(cfg.Chat.DonateViewer, vars)
		}
		return open(cfg.Game.StreamerName, crime, context)
	}
	return false
}
