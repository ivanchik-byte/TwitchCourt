package game

import (
	"bufio"
	"context"
	"os"
	"regexp"
	"time"
)

// Death maps a Minecraft log line to a courtroom charge in Russian.
type Death struct {
	Crime   string
	Context string
}

var deathPatterns = []struct {
	re    *regexp.Regexp
	crime string
}{
	{regexp.MustCompile(`(?i)swim in lava|floor was lava`), "Купание в лаве с полным инвентарем"},
	{regexp.MustCompile(`(?i)blown up by Creeper|was blown up`), "Взрыв на крипере у порога дома"},
	{regexp.MustCompile(`(?i)fell out of the world|fell from a high place|hit the ground`), "Падение в пустоту с алмазами"},
	{regexp.MustCompile(`(?i)drowned|drown`), "Утопление с зачарованной киркой"},
	{regexp.MustCompile(`(?i)was slain by|was shot by`), "Проигранный бой мобу"},
}

// Watcher tails latest.log and reports deaths.
type Watcher struct {
	logPath string
	emit    func(Death)
}

func NewWatcher(logPath string, emit func(Death)) *Watcher {
	return &Watcher{logPath: logPath, emit: emit}
}

func (w *Watcher) Run(ctx context.Context) {
	var offset int64
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		if w.tick(&offset) {
			time.Sleep(500 * time.Millisecond)
		} else {
			time.Sleep(1500 * time.Millisecond)
		}
	}
}

func (w *Watcher) tick(offset *int64) bool {
	f, err := os.Open(w.logPath)
	if err != nil {
		return false
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return false
	}
	if info.Size() < *offset {
		*offset = 0
	}
	if _, err := f.Seek(*offset, 0); err != nil {
		return false
	}

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	advanced := false
	for scanner.Scan() {
		advanced = true
		line := scanner.Text()
		if d, ok := matchDeath(line); ok {
			w.emit(d)
		}
	}
	pos, _ := f.Seek(0, 1)
	*offset = pos
	return advanced
}

func matchDeath(line string) (Death, bool) {
	for _, p := range deathPatterns {
		if p.re.MatchString(line) {
			return Death{Crime: p.crime, Context: line}, true
		}
	}
	return Death{}, false
}
