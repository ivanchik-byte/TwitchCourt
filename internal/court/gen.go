package court

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"strings"
	"time"

	"stream-tribunal/internal/ai"
	"stream-tribunal/internal/safety"
	"stream-tribunal/internal/tmpl"
)

// Variety axes are rolled in Go, not by the model: the LLM obeys frames,
// it must not choose them, otherwise every batch converges to sandwich theft.
var genSettings = []string{
	"прямо на стриме", "в дискорде стримера", "в чате", "за кулисами трансляции",
	"в катке", "в донатах", "в личных сообщениях модератору",
}

var genEras = []string{
	"каменный век", "средневековье", "дикий запад", "киберпанк",
	"советская столовая", "пиратский корабль", "древний рим",
}

var genObjects = []string{
	"микрофон", "клавиатура", "стримерское кресло", "кот",
	"наушники", "вебка", "глобальный чат", "сабскрайб", "клип", "камера",
}

var genAbsurd = []string{
	"бытовая мелочь", "эпичный фейл", "заговор", "мистическое происшествие", "бюрократический кошмар",
}

var genScale = []string{
	"личная обида", "чатный скандал", "угроза репутации канала",
}

func rollAxes() string {
	pick := func(xs []string) string { return xs[rand.Intn(len(xs))] }
	return "Сеттинг: " + pick(genSettings) + ". Эпоха: " + pick(genEras) +
		". Объект спора: " + pick(genObjects) + ". Градус: " + pick(genAbsurd) +
		". Масштаб: " + pick(genScale) + "."
}

func tokens(s string) map[string]bool {
	set := map[string]bool{}
	for _, w := range strings.FieldsFunc(strings.ToLower(s), func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r >= 'а' && r <= 'я' || r == 'ё')
	}) {
		if len([]rune(w)) > 2 {
			set[w] = true
		}
	}
	return set
}

// similar reports near-duplicate titles (Jaccard over tokens).
func similar(a, b string) bool {
	ta, tb := tokens(a), tokens(b)
	if len(ta) == 0 || len(tb) == 0 {
		return strings.TrimSpace(a) == strings.TrimSpace(b)
	}
	inter := 0
	for w := range ta {
		if tb[w] {
			inter++
		}
	}
	union := len(ta) + len(tb) - inter
	return float64(inter)/float64(union) > 0.6
}

type genCase struct {
	Title   string `json:"title"`
	Crime   string `json:"crime"`
	Context string `json:"context"`
}

// StartConfessionTrial generates a case from viewer description and places them on the bench.
func (e *Engine) StartConfessionTrial(author, description string) error {
	description = strings.TrimSpace(description)
	if description == "" {
		return fmt.Errorf("empty confession")
	}
	if safety.Banned(description) {
		return fmt.Errorf("banned topic")
	}
	client := e.currentAI()
	if client == nil || !client.Configured() {
		return fmt.Errorf("ai is not configured: set api_key or base_url in settings")
	}
	prompt := tmpl.Fill(e.cfg.Load().Prompts.Confession, map[string]string{"description": description})
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	var sb strings.Builder
	if err := client.StreamCompletion(ctx,
		[]ai.ChatMessage{{Role: "user", Content: prompt}},
		func(delta string) error {
			sb.WriteString(delta)
			return nil
		}); err != nil {
		return err
	}
	raw := sb.String()
	start, end := strings.Index(raw, "{"), strings.LastIndex(raw, "}")
	if start < 0 || end <= start {
		return fmt.Errorf("no json object in model reply")
	}
	var invented genCase
	if err := json.Unmarshal([]byte(raw[start:end+1]), &invented); err != nil {
		return err
	}
	title := strings.TrimSpace(invented.Title)
	crime := strings.TrimSpace(invented.Crime)
	if title == "" || crime == "" {
		return fmt.Errorf("empty invented case")
	}
	if safety.Banned(title) || safety.Banned(crime) || safety.Banned(invented.Context) {
		return fmt.Errorf("banned topic")
	}
	context := strings.TrimSpace(invented.Context)
	if context != "" {
		context += "\n"
	}
	context += "Самооговор: " + description
	if err := e.startTrialWith(author, crime, context, author); err != nil {
		e.JoinPool(author, crime)
		return fmt.Errorf("court is busy, claim queued")
	}
	return nil
}

// GenerateCases requests fresh cases from the model, filters and saves them.
func (e *Engine) GenerateCases(count int) (int, error) {
	deck := e.CaseDeck()
	if deck == nil {
		return 0, fmt.Errorf("no case deck")
	}
	client := e.currentAI()
	if client == nil || !client.Configured() {
		return 0, fmt.Errorf("ai is not configured: set api_key or base_url in settings")
	}
	if client == nil {
		return 0, fmt.Errorf("no ai client")
	}
	if count <= 0 {
		count = 5
	}
	if count > 10 {
		count = 10
	}

	prompts := e.cfg.Load().Prompts
	existing := deck.List()
	titles := make([]string, 0, len(existing))
	for _, c := range existing {
		titles = append(titles, c.Title)
	}
	if len(titles) > 30 {
		titles = titles[len(titles)-30:]
	}
	frames := make([]string, 0, count*2)
	for i := 0; i < count*2; i++ {
		frames = append(frames, fmt.Sprintf("%d) %s", i+1, rollAxes()))
	}
	prompt := tmpl.Fill(prompts.GenPrompt, map[string]string{
		"count":   fmt.Sprintf("%d", count*2),
		"axes":    strings.Join(frames, "\n"),
		"banlist": strings.Join(titles, "; "),
	})

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	var sb strings.Builder
	if err := client.StreamCompletion(ctx,
		[]ai.ChatMessage{{Role: "user", Content: prompt}},
		func(delta string) error {
			sb.WriteString(delta)
			return nil
		}); err != nil {
		return 0, err
	}
	raw := sb.String()
	start, end := strings.Index(raw, "["), strings.LastIndex(raw, "]")
	if start < 0 || end <= start {
		return 0, fmt.Errorf("no json array in model reply")
	}
	var batch []genCase
	if err := json.Unmarshal([]byte(raw[start:end+1]), &batch); err != nil {
		return 0, err
	}

	added := 0
	seen := append([]string(nil), titles...)
	for _, g := range batch {
		if added >= count {
			break
		}
		title := strings.TrimSpace(g.Title)
		if title == "" {
			continue
		}
		if safety.Banned(title) || safety.Banned(g.Crime) || safety.Banned(g.Context) {
			continue
		}
		dup := false
		for _, have := range seen {
			if similar(title, have) {
				dup = true
				break
			}
		}
		if dup {
			continue
		}
		if _, err := deck.Add(title, g.Crime, g.Context, nil, "ai"); err != nil {
			log.Printf("case store failed: %v", err)
			continue
		}
		seen = append(seen, title)
		added++
	}
	return added, nil
}

type GenJob struct {
	Running bool   `json:"running"`
	Added   int    `json:"added"`
	Error   string `json:"error,omitempty"`
}

func (e *Engine) GenStatus() GenJob {
	e.genMu.Lock()
	defer e.genMu.Unlock()
	return e.genJob
}

func (e *Engine) GenerateCasesAsync(count int) bool {
	e.genMu.Lock()
	if e.genJob.Running {
		e.genMu.Unlock()
		return false
	}
	e.genJob = GenJob{Running: true}
	e.genMu.Unlock()
	go func() {
		added, err := e.GenerateCases(count)
		e.genMu.Lock()
		e.genJob.Running = false
		e.genJob.Added = added
		if err != nil {
			e.genJob.Error = err.Error()
		}
		e.genMu.Unlock()
		log.Printf("background generation: +%d cases (err=%v)", added, err)
	}()
	return true
}

func (e *Engine) EnsureRefill() {
	deck := e.CaseDeck()
	if deck == nil {
		return
	}
	cfg := e.cfg.Load().Courtroom
	low := cfg.CasesGen.LowMark
	if low <= 0 {
		low = 3
	}
	if !cfg.CasesGen.Enabled || deck.Remaining() >= low {
		return
	}
	batch := cfg.CasesGen.Batch
	if batch <= 0 {
		batch = 5
	}
	e.GenerateCasesAsync(batch)
}
