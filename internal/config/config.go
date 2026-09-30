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
}

type ServerConfig struct {
	Host string `yaml:"host"`
	Port int    `yaml:"port"`
}

type AIConfig struct {
	Provider    string  `yaml:"provider"`
	APIKey      string  `yaml:"api_key"`
	Model       string  `yaml:"model"`
	Temperature float64 `yaml:"temperature"`
	Stream      bool    `yaml:"stream"`
}

type TTSConfig struct {
	Enabled     bool    `yaml:"enabled"`
	PiperBinary string  `yaml:"piper_binary"`
	ModelPath   string  `yaml:"model_path"`
	ConfigPath  string  `yaml:"config_path"`
	SpeakerID   int     `yaml:"speaker_id"`
	Speed       float64 `yaml:"speed"`
}

type CourtroomConfig struct {
	Theme              string `yaml:"theme"`
	ProsecutorName     string `yaml:"prosecutor_name"`
	Title              string `yaml:"title"`
	SueThreshold       int    `yaml:"sue_threshold"`
	VotingDurationSec  int    `yaml:"voting_duration_sec"`
}

type SafetyConfig struct {
	FilterEnabled   bool     `yaml:"filter_enabled"`
	CustomBlacklist []string `yaml:"custom_blacklist"`
	PanicHotkey     string   `yaml:"panic_hotkey"`
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
			Enabled:     true,
			PiperBinary: binaryName,
			ModelPath:   filepath.Join("models", "ru_dmitri.onnx"),
			ConfigPath:  filepath.Join("models", "ru_dmitri.onnx.json"),
			SpeakerID:   0,
			Speed:       1.15,
		},
		Courtroom: CourtroomConfig{
			Theme:             "ace_attorney",
			ProsecutorName:    "Прокурор Карлов",
			Title:             "Инквизитор Твича",
			SueThreshold:      5,
			VotingDurationSec: 45,
		},
		Safety: SafetyConfig{
			FilterEnabled:   true,
			CustomBlacklist: []string{},
			PanicHotkey:     "F12",
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
	}
	if key := os.Getenv("CEREBRAS_API_KEY"); key != "" && cfg.AI.APIKey == "" {
		cfg.AI.APIKey = key
		cfg.AI.Provider = "cerebras"
	}

	return cfg, nil
}
