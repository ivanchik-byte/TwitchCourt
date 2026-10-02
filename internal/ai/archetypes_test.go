package ai

import (
	"strings"
	"testing"
)

func TestArchetypes(t *testing.T) {
	if len(Archetypes) < 3 {
		t.Fatalf("want at least 3 archetypes, got %d", len(Archetypes))
	}
	seen := map[string]bool{}
	for _, a := range Archetypes {
		if a.Name == "" || a.System == "" || a.Voice == "" || a.Rate == "" {
			t.Fatalf("archetype has empty fields: %+v", a)
		}
		if !strings.Contains(a.System, "35 слов") {
			t.Fatalf("archetype %q misses brevity cap", a.Name)
		}
		if seen[a.Name] {
			t.Fatalf("duplicate archetype %q", a.Name)
		}
		seen[a.Name] = true
	}
}

func TestDrawArchetype(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 60; i++ {
		seen[DrawArchetype().Name] = true
	}
	if len(seen) < 2 {
		t.Fatal("draw must vary across 60 picks")
	}
}
