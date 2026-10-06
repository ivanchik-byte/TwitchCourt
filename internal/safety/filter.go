package safety

import (
	"fmt"
	"html"
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
	"[клякса]",
	"[штамп]",
	"[протокол]",
	"[архив]",
}

type Filter struct {
	customBlacklist []string
	compiledRegexes []*regexp.Regexp
	replacement     string
	enabled         bool
	mu              sync.RWMutex
}

func NewFilter(blacklist []string) *Filter {
	f := &Filter{
		customBlacklist: blacklist,
		enabled:         true,
	}
	f.compile()
	return f
}

// SetEnabled toggles sanitizing at runtime.
func (f *Filter) SetEnabled(enabled bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.enabled = enabled
}

// SetBlacklist replaces the custom patterns and recompiles.
func (f *Filter) SetBlacklist(list []string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.customBlacklist = append([]string(nil), list...)
	f.compileLocked()
}

func (f *Filter) compile() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.compileLocked()
}

func (f *Filter) compileLocked() {
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

	// benign replacement word avoiding secondary filter triggers
	f.replacement = ""
	for _, candidate := range defaultReplacements {
		banned := false
		for _, re := range f.compiledRegexes {
			if re.MatchString(candidate) {
				banned = true
				break
			}
		}
		if !banned {
			f.replacement = candidate
			break
		}
	}
}

func (f *Filter) Sanitize(input string) string {
	cleaned := input

	f.mu.RLock()
	defer f.mu.RUnlock()

	if !f.enabled {
		return html.EscapeString(cleaned)
	}
	for _, re := range f.compiledRegexes {
		// single pass per pattern: f.replacement cannot re-trigger anything
		cleaned = re.ReplaceAllString(cleaned, "${1}"+f.replacement+"${3}")
	}

	return html.EscapeString(cleaned)
}
