package config

import (
	"testing"
)

func TestCloneIndependence(t *testing.T) {
	orig := DefaultConfig()
	orig.Donations.MinAmounts["RUB"] = 100
	orig.Courtroom.Punishments = []string{"a"}
	orig.Courtroom.Articles = []string{"x"}
	orig.Safety.CustomBlacklist = []string{"z"}

	next := orig.Clone()
	next.Donations.MinAmounts["RUB"] = 999
	next.Courtroom.Punishments[0] = "b"
	next.Courtroom.Articles[0] = "y"
	next.Safety.CustomBlacklist[0] = "w"
	next.AI.Provider = "ollama"

	if orig.Donations.MinAmounts["RUB"] != 100 {
		t.Fatal("clone shares the min_amounts map with the original")
	}
	if orig.Courtroom.Punishments[0] != "a" || orig.Courtroom.Articles[0] != "x" {
		t.Fatal("clone shares slices with the original")
	}
	if orig.Safety.CustomBlacklist[0] != "z" {
		t.Fatal("clone shares the blacklist with the original")
	}
	if orig.AI.Provider == "ollama" {
		t.Fatal("clone shares scalars with the original")
	}
	if CloneNil := (*Config)(nil).Clone(); CloneNil != nil {
		t.Fatal("nil clone must stay nil")
	}
}
