package safety

import (
	"fmt"
	"html"
	"math/rand"
	"regexp"
	"strings"
	"sync"
)

var defaultReplacements = []string{
	"[банан]",
	"[пирожок]",
	"[сыр]",
	"[крендель]",
	"[цензура]",
}

type Filter struct {
	customBlacklist []string
	compiledRegexes []*regexp.Regexp
	mu              sync.RWMutex
}

func NewFilter(blacklist []string) *Filter {
	f := &Filter{
		customBlacklist: blacklist,
	}
	f.compile()
	return f
}

func (f *Filter) compile() {
	f.mu.Lock()
	defer f.mu.Unlock()

	var patterns []string
	patterns = append(patterns, f.customBlacklist...)

	f.compiledRegexes = make([]*regexp.Regexp, 0, len(patterns))
	for _, p := range patterns {
		trimmed := strings.TrimSpace(p)
		if trimmed == "" {
			continue
		}
		pattern := fmt.Sprintf(`(?i)(^|[^\p{L}\p{N}_])(%s)($|[^\p{L}\p{N}_])`, regexp.QuoteMeta(trimmed))
		if re, err := regexp.Compile(pattern); err == nil {
			f.compiledRegexes = append(f.compiledRegexes, re)
		}
	}
}

func (f *Filter) Sanitize(input string) string {
	cleaned := html.EscapeString(input)

	f.mu.RLock()
	defer f.mu.RUnlock()

	for _, re := range f.compiledRegexes {
		for re.MatchString(cleaned) {
			replacement := defaultReplacements[rand.Intn(len(defaultReplacements))]
			cleaned = re.ReplaceAllString(cleaned, "${1}"+replacement+"${3}")
		}
	}

	return cleaned
}
