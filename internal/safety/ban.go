package safety

import "strings"

// bannedRoots is the hard TOS line: generated cases with a hit are dropped,
// donations with a hit are kept but flagged for the bench to condemn.
// Gray topics pass by design. This list stays in code, not in user config:
// loosening it must be a deliberate code change, not a settings typo.
var bannedRoots = []string{
	"убийств", "зареж", "приреж", "расчлен",
	"теракт", "террорис", "бомб", "взорв", "взрывчат",
	"наркотик", "наркот", "героин", "метадон", "мефедрон", "закладк",
	"суицид", "покончи с собой",
	"изнасил", "педофил",
	"оружи",
}

// Banned reports hard TOS topics in text.
func Banned(text string) bool {
	lower := " " + strings.ToLower(text) + " "
	for _, root := range bannedRoots {
		if strings.Contains(lower, root) {
			return true
		}
	}
	return false
}
