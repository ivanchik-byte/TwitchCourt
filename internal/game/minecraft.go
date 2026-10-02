package game

import (
	"bufio"
	"context"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
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
	mu      sync.RWMutex
	logPath string
	nicks   []string
	emit    func(Death)
}

func NewWatcher(logPath string, emit func(Death)) *Watcher {
	return &Watcher{logPath: logPath, emit: emit}
}

func NewWatcherWithNicks(logPath string, nicks []string, emit func(Death)) *Watcher {
	return &Watcher{logPath: logPath, nicks: nicks, emit: emit}
}

func (w *Watcher) SetNicks(nicks []string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.nicks = nicks
}

func (w *Watcher) SetLogPath(logPath string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.logPath = logPath
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
	w.mu.RLock()
	path := w.logPath
	nicks := append([]string(nil), w.nicks...)
	w.mu.RUnlock()

	if path == "" {
		return false
	}

	f, err := os.Open(path)
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
		if len(nicks) > 0 && !NickMatches(line, nicks) {
			continue
		}
		if d, ok := matchDeath(line); ok {
			w.emit(d)
		}
	}
	pos, _ := f.Seek(0, 1)
	*offset = pos
	return advanced
}

func NickMatches(line string, nicks []string) bool {
	if len(nicks) == 0 {
		return true
	}
	lower := strings.ToLower(line)
	for _, nick := range nicks {
		n := strings.ToLower(strings.TrimSpace(nick))
		if n != "" && strings.Contains(lower, n) {
			return true
		}
	}
	return false
}

func matchDeath(line string) (Death, bool) {
	for _, p := range deathPatterns {
		if p.re.MatchString(line) {
			return Death{Crime: p.crime, Context: line}, true
		}
	}
	return Death{}, false
}

func FindDefaultMinecraftLog() (string, []string) {
	candidates := make([]string, 0, 6)
	home, _ := os.UserHomeDir()

	switch runtime.GOOS {
	case "windows":
		appdata := os.Getenv("APPDATA")
		if appdata != "" {
			candidates = append(candidates, filepath.Join(appdata, ".minecraft", "logs", "latest.log"))
		}
		userProfile := os.Getenv("USERPROFILE")
		if userProfile != "" {
			candidates = append(candidates,
				filepath.Join(userProfile, "AppData", "Roaming", ".minecraft", "logs", "latest.log"),
				filepath.Join(userProfile, "AppData", "Roaming", "PrismLauncher", "logs", "latest.log"),
			)
		}
	case "darwin":
		if home != "" {
			candidates = append(candidates,
				filepath.Join(home, "Library", "Application Support", "minecraft", "logs", "latest.log"),
				filepath.Join(home, "Library", "Application Support", "PrismLauncher", "logs", "latest.log"),
			)
		}
	default:
		if home != "" {
			candidates = append(candidates,
				filepath.Join(home, ".minecraft", "logs", "latest.log"),
				filepath.Join(home, ".var", "app", "com.mojang.Minecraft", ".minecraft", "logs", "latest.log"),
				filepath.Join(home, ".local", "share", "PrismLauncher", "logs", "latest.log"),
			)
		}
	}

	for _, p := range candidates {
		if fi, err := os.Stat(p); err == nil && !fi.IsDir() {
			return p, candidates
		}
	}
	defaultPath := ""
	if len(candidates) > 0 {
		defaultPath = candidates[0]
	}
	return defaultPath, candidates
}
