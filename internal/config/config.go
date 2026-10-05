package config

import (
	"os"
	"path/filepath"
	"runtime"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server    ServerConfig    `yaml:"server"`
	AI        AIConfig        `yaml:"ai"`
	TTS       TTSConfig       `yaml:"tts"`
	Courtroom CourtroomConfig `yaml:"courtroom"`
	Safety    SafetyConfig    `yaml:"safety"`
	Game      GameConfig      `yaml:"game"`
	Twitch    TwitchConfig    `yaml:"twitch"`
	Donations DonationsConfig `yaml:"donations"`
}

type ServerConfig struct {
	Host   string `yaml:"host"`
	Port   int    `yaml:"port"`
	Secret string `yaml:"secret"`
}

type AIConfig struct {
	Provider    string  `yaml:"provider"`
	APIKey      string  `yaml:"api_key"`
	Model       string  `yaml:"model"`
	Temperature float64 `yaml:"temperature"`
	Stream      bool    `yaml:"stream"`
	BaseURL     string  `yaml:"base_url"`
}

type TTSConfig struct {
	Enabled      bool    `yaml:"enabled"`
	Engine       string  `yaml:"engine"`
	Voice        string  `yaml:"voice"`
	Rate         string  `yaml:"rate"`
	Volume       string  `yaml:"volume"`
	Pitch        string  `yaml:"pitch"`
	AutoFallback bool    `yaml:"auto_fallback"`
	JudgeVoice   string  `yaml:"judge_voice"`
	JudgeRate    string  `yaml:"judge_rate"`
	SileroURL    string  `yaml:"silero_url"`
	SileroJudge  string  `yaml:"silero_judge"`
	PiperBinary  string  `yaml:"piper_binary"`
	ModelPath    string  `yaml:"model_path"`
	ConfigPath   string  `yaml:"config_path"`
	SpeakerID    int     `yaml:"speaker_id"`
	Speed        float64 `yaml:"speed"`
}

type CourtroomConfig struct {
	Theme        string   `yaml:"theme"`
	JudgeName    string   `yaml:"judge_name"`
	JudgeStyle   string   `yaml:"judge_style"`
	DefenseSec   int      `yaml:"defense_sec"`
	TestimonySec int      `yaml:"testimony_sec"`
	SueThreshold int      `yaml:"sue_threshold"`
	SueWindowSec int      `yaml:"sue_window_sec"`
	Articles     []string `yaml:"articles"`
	Punishments  []string `yaml:"punishments"`
}

type DonationsConfig struct {
	Token            string             `yaml:"token"`
	DefaultMin       float64            `yaml:"default_min"`
	PlatinumMin      float64            `yaml:"platinum_min"`
	StreamerTrialMin float64            `yaml:"streamer_trial_min"`
	MinAmounts       map[string]float64 `yaml:"min_amounts"`
	DonationAlerts   WidgetSource       `yaml:"donationalerts"`
	DonatePay        KeySource          `yaml:"donatepay"`
	TwitchBits       ToggleSource       `yaml:"twitch_bits"`
}

type WidgetSource struct {
	Enabled bool   `yaml:"enabled"`
	Token   string `yaml:"token"`
}

type KeySource struct {
	Enabled bool   `yaml:"enabled"`
	APIKey  string `yaml:"api_key"`
}

type ToggleSource struct {
	Enabled bool `yaml:"enabled"`
}

type SafetyConfig struct {
	FilterEnabled   bool     `yaml:"filter_enabled"`
	CustomBlacklist []string `yaml:"custom_blacklist"`
	PanicHotkey     string   `yaml:"panic_hotkey"`
}

type GameConfig struct {
	StreamerName string `yaml:"streamer_name"`
	MemoryPath   string `yaml:"memory_path"`
	DonateToken  string `yaml:"donate_token"`
}

type TwitchConfig struct {
	Channel       string `yaml:"channel"`
	Nick          string `yaml:"nick"`
	Token         string `yaml:"token"`
	ClientID      string `yaml:"client_id"`
	BroadcasterID string `yaml:"broadcaster_id"`
	ModeratorID   string `yaml:"moderator_id"`
}

func DefaultConfig() *Config {
	binaryName := "bin/piper"
	if runtime.GOOS == "windows" {
		binaryName = filepath.Join("bin", "piper.exe")
	}

	return &Config{
		Server: ServerConfig{
			Host: "127.0.0.1",
			Port: 7890,
		},
		AI: AIConfig{
			Provider:    "groq",
			APIKey:      "",
			Model:       "llama-3.3-70b-versatile",
			Temperature: 0.85,
			Stream:      true,
		},
		TTS: TTSConfig{
			Enabled:      true,
			Engine:       "edge",
			Voice:        "ru-RU-SvetlanaNeural",
			Rate:         "+0%",
			Volume:       "+0%",
			Pitch:        "+0Hz",
			AutoFallback: true,
			JudgeVoice:   "ru-RU-SvetlanaNeural",
			JudgeRate:    "-10%",
			SileroURL:    "http://127.0.0.1:7892",
			SileroJudge:  "xenia",
			PiperBinary:  binaryName,
			ModelPath:    filepath.Join("models", "ru_irina.onnx"),
			ConfigPath:   filepath.Join("models", "ru_irina.onnx.json"),
			SpeakerID:    0,
			Speed:        1.15,
		},
		Courtroom: CourtroomConfig{
			Theme:        "ace_attorney",
			JudgeName:    "Судья",
			JudgeStyle:   "strict",
			DefenseSec:   20,
			TestimonySec: 25,
			SueThreshold: 5,
			SueWindowSec: 600,
			Articles: []string{
				"Слив катки",
				"Токсичность в чате",
				"Опоздание",
				"Байт на бан",
				"Духота в голосовом",
			},
			Punishments: []string{
				"10 приседаний в прямом эфире",
				"Минута молчания с рукой на сердце",
				"Ч/б фильтр на вебку до конца стрима",
			},
		},
		Safety: SafetyConfig{
			FilterEnabled:   true,
			CustomBlacklist: []string{},
			PanicHotkey:     "F12",
		},
		Game: GameConfig{
			StreamerName: "Стример",
			MemoryPath:   "data/memory.json",
			DonateToken:  "",
		},
		Twitch: TwitchConfig{
			Channel: "",
			Nick:    "tribunal_bot",
			Token:   "",
		},
		Donations: DonationsConfig{
			Token:       "",
			DefaultMin:  100,
			PlatinumMin: 500,
			MinAmounts:  map[string]float64{"RUB": 100, "USD": 2, "EUR": 2, "BITS": 200},
			DonationAlerts: WidgetSource{
				Enabled: true,
				Token:   "",
			},
			DonatePay: KeySource{
				Enabled: true,
				APIKey:  "",
			},
			TwitchBits: ToggleSource{
				Enabled: true,
			},
		},
	}
}

func LoadConfig(path string) (*Config, error) {
	cfg := DefaultConfig()

	fileBytes, err := os.ReadFile(path)
	if err == nil {
		if err := yaml.Unmarshal(fileBytes, cfg); err != nil {
			return nil, err
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}

	if key := os.Getenv("GROQ_API_KEY"); key != "" && cfg.AI.APIKey == "" {
		cfg.AI.APIKey = key
		cfg.AI.Provider = "groq"
	}
	if key := os.Getenv("CEREBRAS_API_KEY"); key != "" && cfg.AI.APIKey == "" {
		cfg.AI.APIKey = key
		cfg.AI.Provider = "cerebras"
	}

	if key := os.Getenv("DONATE_TOKEN"); key != "" {
		cfg.Donations.Token = key
		cfg.Donations.DonationAlerts.Token = key
	}
	if cfg.Donations.DonationAlerts.Token == "" {
		cfg.Donations.DonationAlerts.Token = cfg.Donations.Token
	}
	if key := os.Getenv("DONATEPAY_API_KEY"); key != "" {
		cfg.Donations.DonatePay.APIKey = key
	}
	if cfg.Donations.Token == "" && cfg.Game.DonateToken != "" {
		cfg.Donations.Token = cfg.Game.DonateToken
	}
	if token := os.Getenv("TWITCH_TOKEN"); token != "" && cfg.Twitch.Token == "" {
		cfg.Twitch.Token = token
	}
	if secret := os.Getenv("TRIBUNAL_SECRET"); secret != "" && cfg.Server.Secret == "" {
		cfg.Server.Secret = secret
	}
	if cfg.Twitch.ModeratorID == "" {
		cfg.Twitch.ModeratorID = cfg.Twitch.BroadcasterID
	}

	switch cfg.TTS.Engine {
	case "edge", "piper", "mock", "silero":
	default:
		cfg.TTS.Engine = "edge"
	}
	if cfg.TTS.SileroURL == "" {
		cfg.TTS.SileroURL = "http://127.0.0.1:7892"
	}
	if cfg.TTS.SileroJudge == "" {
		cfg.TTS.SileroJudge = "xenia"
	}
	if cfg.TTS.Voice == "" {
		cfg.TTS.Voice = "ru-RU-SvetlanaNeural"
	}
	if cfg.TTS.JudgeVoice == "" {
		cfg.TTS.JudgeVoice = "ru-RU-SvetlanaNeural"
	}
	if cfg.TTS.JudgeRate == "" {
		cfg.TTS.JudgeRate = "-10%"
	}
	if cfg.Courtroom.JudgeName == "" {
		cfg.Courtroom.JudgeName = "Судья"
	}
	if cfg.Courtroom.JudgeStyle != "cynical" {
		cfg.Courtroom.JudgeStyle = "strict"
	}
	if cfg.Courtroom.DefenseSec <= 0 {
		cfg.Courtroom.DefenseSec = 20
	}
	if cfg.Courtroom.SueThreshold < 0 {
		cfg.Courtroom.SueThreshold = 5
	}
	if cfg.Courtroom.SueWindowSec <= 0 {
		cfg.Courtroom.SueWindowSec = 600
	}
	if cfg.Donations.StreamerTrialMin < 0 {
		cfg.Donations.StreamerTrialMin = 0
	}

	return cfg, nil
}

// Clone deep-copies maps and slices so a mutated clone can be published
// via atomic pointer swap without racing live readers (RCU pattern).
func (c *Config) Clone() *Config {
	if c == nil {
		return nil
	}
	out := *c
	if c.Donations.MinAmounts != nil {
		out.Donations.MinAmounts = make(map[string]float64, len(c.Donations.MinAmounts))
		for k, v := range c.Donations.MinAmounts {
			out.Donations.MinAmounts[k] = v
		}
	}
	if c.Courtroom.Punishments != nil {
		out.Courtroom.Punishments = append([]string(nil), c.Courtroom.Punishments...)
	}
	if c.Courtroom.Articles != nil {
		out.Courtroom.Articles = append([]string(nil), c.Courtroom.Articles...)
	}
	if c.Safety.CustomBlacklist != nil {
		out.Safety.CustomBlacklist = append([]string(nil), c.Safety.CustomBlacklist...)
	}
	return &out
}

// Save writes the whole config back to disk, secrets included, mode 0600
func (c *Config) Save(path string) error {
	raw, err := yaml.Marshal(c)
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
