package court

import (
	"embed"
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

//go:embed packs/*.yaml
var casePackFiles embed.FS

type CasePack struct {
	ID          string     `yaml:"id" json:"id"`
	Title       string     `yaml:"title" json:"title"`
	Description string     `yaml:"description" json:"description"`
	Cases       []CaseCard `yaml:"cases" json:"cases"`
}

func CasePacks() ([]CasePack, error) {
	files, err := casePackFiles.ReadDir("packs")
	if err != nil {
		return nil, err
	}
	packs := make([]CasePack, 0, len(files))
	for _, file := range files {
		raw, err := casePackFiles.ReadFile("packs/" + file.Name())
		if err != nil {
			return nil, err
		}
		var pack CasePack
		if err := yaml.Unmarshal(raw, &pack); err != nil {
			return nil, fmt.Errorf("case pack %s: %w", file.Name(), err)
		}
		packs = append(packs, pack)
	}
	return packs, nil
}

// ImportPack preserves edited cards and played status; stable IDs make retries harmless.
func (d *CaseDeck) ImportPack(pack CasePack) (int, error) {
	d.fileMu.Lock()
	defer d.fileMu.Unlock()
	var file struct {
		Cases []CaseCard `yaml:"cases"`
	}
	raw, err := os.ReadFile(d.path)
	if err != nil && !os.IsNotExist(err) {
		return 0, err
	}
	if len(raw) > 0 {
		if err := yaml.Unmarshal(raw, &file); err != nil {
			return 0, err
		}
	}
	known := make(map[string]bool, len(file.Cases))
	for _, card := range file.Cases {
		known[card.ID] = true
	}
	var added []CaseCard
	for _, card := range pack.Cases {
		if known[card.ID] {
			continue
		}
		known[card.ID] = true
		card.Weight = 1
		added = append(added, card)
	}
	if len(added) == 0 {
		return 0, nil
	}
	file.Cases = append(file.Cases, added...)
	if err := d.writeCardsLocked(file.Cases); err != nil {
		return 0, err
	}
	d.mu.Lock()
	d.all = file.Cases
	for _, card := range added {
		used := false
		if d.recall != nil {
			for _, id := range d.recall.UsedCases() {
				if id == card.ID {
					used = true
					break
				}
			}
		}
		if !used {
			d.remaining = append(d.remaining, card)
		}
	}
	d.mu.Unlock()
	return len(added), nil
}
