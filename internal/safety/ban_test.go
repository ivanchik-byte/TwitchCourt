package safety

import "testing"

func TestBannedHits(t *testing.T) {
	for _, s := range []string{"убийство судьи", "ТЕРАКТ в чате", "где купить наркотик", "бомба в чате"} {
		if !Banned(s) {
			t.Fatalf("must flag %q", s)
		}
	}
}

func TestBannedGrayPasses(t *testing.T) {
	for _, s := range []string{
		"слил катку", "украл бутерброд", "перднул в микрофон",
		"как убить время", "убил курицу по дороге",
		"бомбардир чата", "детский утренник сорван", "выборы старосты чата",
	} {
		if Banned(s) {
			t.Fatalf("gray topic must pass: %q", s)
		}
	}
}
