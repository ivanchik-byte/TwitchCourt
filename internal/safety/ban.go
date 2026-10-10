package safety

import (
	"fmt"
	"regexp"
)

// bannedRoots is the hard TOS line: generated cases with a hit are dropped,
// donations with a hit are kept but flagged for the bench to condemn.
// Gray topics pass by design. This list stays in code, not in user config:
// loosening it must be a deliberate code change, not a settings typo.
var bannedFragments = []string{
	`убийств[\p{L}]*`,
	`зареж[\p{L}]*`, `приреж[\p{L}]*`, `расчлен[\p{L}]*`,
	`теракт[\p{L}]*`, `террорис[\p{L}]*`,
	`бомб(а|ы|у|е|ой|ам|ами|ах)?`,
	`взорв[\p{L}]*`, `взрывчат[\p{L}]*`,
	`наркотик[\p{L}]*`, `наркот[\p{L}]*`,
	`героин[\p{L}]*`, `метадон[\p{L}]*`, `мефедрон[\p{L}]*`, `закладк[\p{L}]*`,
	`суицид[\p{L}]*`, `покончи с собой`,
	`изнасил[\p{L}]*`, `педофил[\p{L}]*`,
	`оружи[\p{L}]*`,
}

var bannedRes = func() []*regexp.Regexp {
	out := make([]*regexp.Regexp, 0, len(bannedFragments))
	for _, frag := range bannedFragments {
		pattern := fmt.Sprintf(`(?i)(?:^|[^\p{L}\p{N}_])(?:%s)(?:$|[^\p{L}\p{N}_])`, frag)
		if re, err := regexp.Compile(pattern); err == nil {
			out = append(out, re)
		}
	}
	return out
}()

// Banned reports hard TOS topics in text.
func Banned(text string) bool {
	for _, re := range bannedRes {
		if re.MatchString(text) {
			return true
		}
	}
	return false
}
