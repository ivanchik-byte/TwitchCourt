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

func TestNickMatches(t *testing.T) {
	nicks := []string{"Steve", "Alex", "Streamer123"}

	if !NickMatches("Steve was blown up by Creeper", nicks) {
		t.Fatal("expected match for Steve")
	}
	if !NickMatches("[12:00:00] [CHAT] <alex> died in lava", nicks) {
		t.Fatal("expected case-insensitive match for alex")
	}
	if NickMatches("RandomPlayer fell from a high place", nicks) {
		t.Fatal("expected no match for RandomPlayer")
	}
	if !NickMatches("RandomPlayer fell", nil) {
		t.Fatal("expected match when nicks list is empty (tracks all)")
	}
}

func TestFindDefaultMinecraftLog(t *testing.T) {
	path, candidates := FindDefaultMinecraftLog()
	if len(candidates) == 0 {
		t.Fatal("expected non-empty candidates list")
	}
	t.Logf("default log path: %q, candidates count: %d", path, len(candidates))
}
