package game

import "testing"

func TestMatchDeath(t *testing.T) {
	cases := map[string]string{
		"Steve tried to swim in lava":           "Купание в лаве с полным инвентарем",
		"Steve was blown up by Creeper":         "Взрыв на крипере у порога дома",
		"Steve fell out of the world":           "Падение в пустоту с алмазами",
		"Steve drowned whilst trying to escape": "Утопление с зачарованной киркой",
		"Steve was slain by Zombie":             "Проигранный бой мобу",
		"Steve joined the game":                 "",
	}
	for line, want := range cases {
		got, ok := matchDeath(line)
		if want == "" && ok {
			t.Fatalf("line %q should not match", line)
		}
		if want != "" && (!ok || got.Crime != want) {
			t.Fatalf("line %q got %+v, want %q", line, got, want)
		}
	}
}
