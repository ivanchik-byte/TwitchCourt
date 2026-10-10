package main

import (
	"strconv"
	"strings"

	"stream-tribunal/internal/config"
	"stream-tribunal/internal/tmpl"
)

// isBribe spots donor money worth the bench's attention: a hint in words
// or a sum big enough to notice. Deliberately loose, the judge decides.
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

// openDonationTrial maps donation amount to a trial; streamer trial takes priority
func openDonationTrial(cfg *config.Config, open func(defendant, crime, context string) bool, donor string, amount float64, currency, message string) {
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
		// big money puts the streamer on the bench (documented behavior)
		if crime == "" {
			crime = tmpl.Fill(cfg.Chat.DonateStreamer, vars)
		}
		if crime == "" {
			crime = tmpl.Fill(cfg.Chat.DonateViewer, vars)
		}
		open(cfg.Game.StreamerName, crime, context)
	}
}
