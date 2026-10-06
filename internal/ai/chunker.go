package ai

import (
	"regexp"
	"strings"
	"unicode"
)

var tagRegex = regexp.MustCompile(`\[(slam|objection|desk_slam|shock|nod)\]`)

type SentenceChunk struct {
	Text      string
	Animation string
	IsLast    bool
}

type SentenceChunker struct {
	buffer        strings.Builder
	lastAnimation string
	banned        map[string]bool
}

func NewSentenceChunker() *SentenceChunker {
	return &SentenceChunker{}
}

// NewPhaseChunker filters animation tags outside allowed phase whitelist
func NewPhaseChunker(banned ...string) *SentenceChunker {
	c := &SentenceChunker{}
	if len(banned) > 0 {
		c.banned = make(map[string]bool, len(banned))
		for _, tag := range banned {
			c.banned[tag] = true
		}
	}
	return c
}

func (c *SentenceChunker) Feed(delta string) []SentenceChunk {
	c.buffer.WriteString(delta)
	current := c.buffer.String()

	matches := tagRegex.FindAllStringSubmatch(current, -1)
	if len(matches) > 0 {
		for _, m := range matches {
			if !c.banned[m[1]] {
				c.lastAnimation = m[1]
			}
		}
		current = tagRegex.ReplaceAllString(current, "")
		c.buffer.Reset()
		c.buffer.WriteString(current)
	}

	var results []SentenceChunk
	for {
		endByte := findSentenceBoundary(current)
		if endByte == -1 {
			break
		}

		sentence := strings.TrimSpace(current[:endByte+1])
		current = strings.TrimLeftFunc(current[endByte+1:], unicode.IsSpace)
		c.buffer.Reset()
		c.buffer.WriteString(current)

		if sentence != "" {
			results = append(results, SentenceChunk{
				Text:      sentence,
				Animation: c.lastAnimation,
				IsLast:    false,
			})
			c.lastAnimation = ""
		}
	}

	return results
}

func (c *SentenceChunker) Flush() *SentenceChunk {
	remaining := strings.TrimSpace(c.buffer.String())
	c.buffer.Reset()

	if remaining == "" {
		return nil
	}

	chunk := &SentenceChunk{
		Text:      remaining,
		Animation: c.lastAnimation,
		IsLast:    true,
	}
	c.lastAnimation = ""
	return chunk
}

func findSentenceBoundary(s string) int {
	type runeToken struct {
		byteEnd int
		r       rune
	}

	var tokens []runeToken
	for byteOffset, r := range s {
		tokens = append(tokens, runeToken{
			byteEnd: byteOffset + len(string(r)),
			r:       r,
		})
	}

	n := len(tokens)
	for i := 0; i < n; i++ {
		r := tokens[i].r
		if r == '.' || r == '!' || r == '?' || r == '\n' {
			if i+1 < n && isPunctuation(tokens[i+1].r) {
				continue
			}
			if i > 2 {
				return tokens[i].byteEnd - 1
			}
		}

		if (r == ',' || r == ';' || r == ':') && i > 60 {
			if i+1 < n && unicode.IsSpace(tokens[i+1].r) {
				return tokens[i].byteEnd - 1
			}
		}
	}
	return -1
}

func isPunctuation(r rune) bool {
	return r == '.' || r == '!' || r == '?' || r == ')' || r == '"' || r == '\''
}
