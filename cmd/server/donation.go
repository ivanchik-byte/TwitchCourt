package main

import (
	"strconv"
	"strings"

	"stream-tribunal/internal/config"
)

// isBribe spots donor money marked as a judge payoff
func isBribe(message string) bool {
	return strings.Contains(strings.ToLower(message), "взятк")
}

// openDonationTrial maps a donation amount to at most one trial.
// StreamerTrialMin wins when both thresholds match, so a big donation
// never opens two competing cases.
func openDonationTrial(cfg *config.Config, open func(defendant, crime, context string) bool, donor string, amount float64, currency, message string) {
	crime := ""
	if strings.TrimSpace(message) != "" {
		crime = "Донат: " + strings.TrimSpace(message)
	}
	context := "Донат " + strconv.FormatFloat(amount, 'f', -1, 64) + " " + currency + " от " + donor
	switch {
	case cfg.Donations.StreamerTrialMin > 0 && amount >= cfg.Donations.StreamerTrialMin:
		if crime == "" {
			crime = "Донат с требованием суда над стримером"
		}
		open(cfg.Game.StreamerName, crime, context)
	case cfg.Donations.PlatinumMin > 0 && amount >= cfg.Donations.PlatinumMin:
		if crime == "" {
			crime = "Донат с требованием суда"
		}
		open(cfg.Game.StreamerName, crime, context)
	}
}
