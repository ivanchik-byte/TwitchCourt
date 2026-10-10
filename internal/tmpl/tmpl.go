package tmpl

import "strings"

// Fill substitutes {key} vars in t. Empty template renders nothing:
// unconfigured lines stay silent instead of speaking baked-in text.
func Fill(t string, vars map[string]string) string {
	if strings.TrimSpace(t) == "" {
		return ""
	}
	out := t
	for k, v := range vars {
		out = strings.ReplaceAll(out, "{"+k+"}", v)
	}
	return out
}
