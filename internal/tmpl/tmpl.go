package tmpl

import (
	"sort"
	"strings"
)

// Fill substitutes {key} vars in t. Empty template joins values plainly,
// so unconfigured lines stay silent instead of speaking baked-in text.
func Fill(t string, vars map[string]string) string {
	if strings.TrimSpace(t) == "" {
		keys := make([]string, 0, len(vars))
		for k, v := range vars {
			if strings.TrimSpace(v) != "" {
				keys = append(keys, k)
			}
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, k := range keys {
			parts = append(parts, vars[k])
		}
		return strings.Join(parts, " ")
	}
	out := t
	for k, v := range vars {
		out = strings.ReplaceAll(out, "{"+k+"}", v)
	}
	return out
}
