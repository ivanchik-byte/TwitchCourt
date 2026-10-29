package config

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server     ServerConfig     `yaml:"server"`
	AI         AIConfig         `yaml:"ai"`
	TTS        TTSConfig        `yaml:"tts"`
	Appearance AppearanceConfig `yaml:"appearance"`
	Courtroom  CourtroomConfig  `yaml:"courtroom"`
	Safety     SafetyConfig     `yaml:"safety"`
	Game       GameConfig       `yaml:"game"`
	Twitch     TwitchConfig     `yaml:"twitch"`
	Donations  DonationsConfig  `yaml:"donations"`
	Chat       ChatConfig       `yaml:"chat"`
	Prompts    PromptsConfig    `yaml:"prompts"`
}

type AppearanceConfig struct {
	Theme        string `yaml:"theme"`
	JudgePreset  string `yaml:"judge_preset"`
	ShowJudge    bool   `yaml:"show_judge"`
	ReduceMotion bool   `yaml:"reduce_motion"`
}

type ServerConfig struct {
	Host   string `yaml:"host"`
	Port   int    `yaml:"port"`
	Secret string `yaml:"secret"`
}

type AIConfig struct {
	Provider    string         `yaml:"provider"`
	APIKey      string         `yaml:"api_key"`
	Model       string         `yaml:"model"`
	Temperature float64        `yaml:"temperature"`
	Stream      bool           `yaml:"stream"`
	BaseURL     string         `yaml:"base_url"`
	ExtraBody   map[string]any `yaml:"extra_body"`
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
	QueueOpen      bool     `yaml:"queue_open"`
	Theme          string   `yaml:"theme"`
	JudgeName      string   `yaml:"judge_name"`
	JudgeStyle     string   `yaml:"judge_style"`
	DefenseSec     int      `yaml:"defense_sec"`
	TestimonySec   int      `yaml:"testimony_sec"`
	SueThreshold   int      `yaml:"sue_threshold"`
	SueWindowSec   int      `yaml:"sue_window_sec"`
	StreamerChance float64  `yaml:"streamer_chance"`
	CrimeEnabled   bool     `yaml:"crime_enabled"`
	Articles       []string `yaml:"articles"`
	Punishments    []string `yaml:"punishments"`
	// spoken templates, all optional: empty = that line stays silent
	StandbyIndictment   string         `yaml:"standby_indictment"`
	StandbyDeliberation string         `yaml:"standby_deliberation"`
	StandbyObjection    string         `yaml:"standby_objection"`
	SilentDefense       string         `yaml:"silent_defense"`
	WitnessIntro        string         `yaml:"witness_intro"`
	WitnessOutro        string         `yaml:"witness_outro"`
	EmptyTestimony      string         `yaml:"empty_testimony"`
	BribeTwist          string         `yaml:"bribe_twist"`
	UndecidedTwist      string         `yaml:"undecided_twist"`
	WitnessLine         string         `yaml:"witness_line"`
	TestimonyPrefix     string         `yaml:"testimony_prefix"`
	DefensePrefix       string         `yaml:"defense_prefix"`
	SnitchPrefix        string         `yaml:"snitch_prefix"`
	PenaltyTimeout      string         `yaml:"penalty_timeout"`
	PenaltyPardon       string         `yaml:"penalty_pardon"`
	PenaltyBan          string         `yaml:"penalty_ban"`
	PenaltyPrefix       string         `yaml:"penalty_prefix"`
	CasesFile           string         `yaml:"cases_file"`
	CasesGen            CasesGenConfig `yaml:"cases_gen"`
}

// CasesGenConfig drives background case generation.
type CasesGenConfig struct {
	Enabled bool `yaml:"enabled"`
	Batch   int  `yaml:"batch"`
	LowMark int  `yaml:"low_mark"`
}

type ChatConfig struct {
	QueueJoined    string `yaml:"queue_joined"`
	QueueLeft      string `yaml:"queue_left"`
	SelfTrial      string `yaml:"self_trial"`
	VerdictLine    string `yaml:"verdict_line"`
	StreamerNext   string `yaml:"streamer_next"`
	DonateCrime    string `yaml:"donate_crime"`
	DonateStreamer string `yaml:"donate_streamer"`
	DonateViewer   string `yaml:"donate_viewer"`
	DonateContext  string `yaml:"donate_context"`
	SueContext     string `yaml:"sue_context"`
	DefaultCrime   string `yaml:"default_crime"`
	StreamerCrime  string `yaml:"streamer_crime"`
}

// PromptsConfig holds customizable courtroom persona prompts.
type PromptsConfig struct {
	JudgeStrict      string `yaml:"judge_strict"`
	JudgeCynical     string `yaml:"judge_cynical"`
	Prosecutor       string `yaml:"prosecutor"`
	Prosody          string `yaml:"prosody"`
	TaskIndictment   string `yaml:"task_indictment"`
	TaskCounter      string `yaml:"task_counter"`
	TaskDeliberation string `yaml:"task_deliberation"`
	BribeNote        string `yaml:"bribe_note"`
	CondemnNote      string `yaml:"condemn_note"`
	GenPrompt        string `yaml:"gen_prompt"`
	Confession       string `yaml:"confession"`
}

// DefaultPrompts returns the default courtroom personas.
func DefaultPrompts() PromptsConfig {
	return PromptsConfig{
		JudgeStrict: `Ты судья развлекательного стрим-суда: спокойная, внимательная, с сухим чувством юмора.
Разбирай спор по фактам. Серьёзно относись к мелкому предмету спора, но оставляй место защите и неожиданному оправданию.
Замечай двойные стандарты и слишком удобные объяснения. Не превращай каждую реплику в унижение подсудимого.
PG-13: без мата, дискриминации, политики и реального насилия.`,
		JudgeCynical: `Ты судья развлекательного стрим-суда: вальяжная, тщеславная, неравнодушная к церемониям и подаркам.
Взятку можешь принять, отвергнуть или истолковать неожиданно. Деньги не гарантируют нужного решения; всё равно ответь на конкретный довод по делу.
Твой юмор — в разнице между заявленным достоинством суда и собственным мелким удобством. Не проси донат в каждой реплике.
PG-13: без мата, дискриминации, политики и реального насилия.`,
		Prosecutor: `Ты прокурор в развлекательном суде над стримером. Держись обвинения и задавай неудобные вопросы.
Лови противоречие в конкретном оправдании; не меняй факты ради победы. Если защита сняла один пункт, признай это и проверь оставшийся.
Не объявляй себя судьёй и не выноси приговор до совещания. Острота должна относиться к поступку, а не к личности ведущего.
PG-13: без мата, дискриминации, политики и реального насилия.`,
		Prosody: `АУДИО-РЕЖИССУРА:
Пиши так, чтобы реплику было удобно произнести вслух. Обычная пунктуация, короткие фразы, естественная пауза перед последним словом.
Без повторяющихся «кхм», «так-так», смеха, ремарок в скобках и команд голосовому движку. Не вставляй плюсики ударений и SSML: выбранные движки обрабатывают их по-разному.`,
		TaskIndictment: `Открой дело без заранее вынесенного приговора. Возьми один факт из материалов и задай точный вопрос, который оставляет защите возможность ответить.
Один комический поворот достаточен. Не перечисляй все улики, не придумывай номера законов и не пересказывай чужие ответы заранее.`,
		TaskCounter: `Ответь на последний аргумент ведущего с учётом материалов и уже приобщённых улик. Зацепись за конкретное противоречие или признай сильную часть довода.
Не повторяй обвинение и не подменяй сказанное защитой более глупой версией. Короткое возражение должно приглашать к продолжению спора.`,
		TaskDeliberation: `Вынеси игровой вердикт. Свяжи решение с одним конкретным фактом защиты или приобщённой уликой; укажи, почему противоположный довод не перевесил.
Мотив короткий, с одной точной остротой. Не выдавай воображаемое правило за настоящий закон и не назначай реальный вред. Не задавай новый вопрос вместо решения.`,
		BribeNote:   `На столе взятка: {donor} суёт {amount} {currency}{message}. Ты живой судья, а не автомат: делай с этим что хочешь — прими и оправдай, гордо откажи, разозлись, высмей взяткодателя, обидься на мелочность, устрой сцену. Никаких рамок, это ролевая игра — главное чтобы чату было смешно. Своё решение отрази в вердикте и репликах.`,
		CondemnNote: `ВНИМАНИЕ: в показаниях запретная тема (слово уже вырезано фильтром, ты его не видишь и не должен восстанавливать). Правила: НИКОГДА не произноси и не пересказывай запретное слово, даже в шутку и даже «в кавычках». НЕ соглашайся с автором даже частично, никаких «раньше так говорили» и «в этом есть доля правды». Осуди автора от имени суда одной уничтожающей фразой и высмей ЕГО — его жадность, глупость и смелость позориться за деньги, а не тех, кого он оскорбил.`,
		Confession: `Зритель придумывает себе дело одной фразой: {description}.
Сочини смешное абсурдное дело для сатирического стрим-суда: в духе бытовых баек с Reddit, но без запреток Twitch (без мата, политики, реального насилия и дискриминации).
Формат ответа: JSON-объект {"title": "...", "crime": "...", "context": "..."}.
Только JSON, без пояснений.`, GenPrompt: `Подготовь {count} вымышленных дел для развлекательного стрим-суда. Конфликты узнаваемые, ставки небольшие, обе стороны могут привести разумный довод.
Рамки для разных дел:
{axes}
Не повторяй уже использованные темы и приёмы: {banlist}
У каждого дела: короткое понятное название без пафосных титулов; одно конкретное обвинение; контекст из двух-трёх фактов, среди которых есть полезный для защиты.
Смешное — в неудобной детали, двойном стандарте или слишком серьёзной реакции на мелочь. Не добавляй случайную магию, заговор и абсурд только ради слова «смешно». Не выдавай выдумку за историю с Reddit и не сочиняй ссылки.
PG-13: без мата, дискриминации, политики и реального насилия. Ответ: только JSON-массив объектов {"title":"...","crime":"...","context":"..."}.`,
	}
}

type DonationsConfig struct {
	WitnessEnabled   bool               `yaml:"witness_enabled"`
	RuleCurrency     string             `yaml:"rule_currency"`
	QueueMin         float64            `yaml:"queue_min"`
	Token            string             `yaml:"token"`
	DefaultMin       float64            `yaml:"default_min"`
	PlatinumMin      float64            `yaml:"platinum_min"`
	StreamerTrialMin float64            `yaml:"streamer_trial_min"`
	BribeMin         float64            `yaml:"bribe_min"`
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
	BanConfirm      bool     `yaml:"ban_confirm"`
	BribeWords      []string `yaml:"bribe_words"`
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
			SileroJudge:  "kseniya",
			PiperBinary:  binaryName,
			ModelPath:    filepath.Join("models", "ru_irina.onnx"),
			ConfigPath:   filepath.Join("models", "ru_irina.onnx.json"),
			SpeakerID:    0,
			Speed:        1.15,
		},
		Appearance: AppearanceConfig{Theme: "graphite", ShowJudge: true},
		Courtroom: CourtroomConfig{
			CasesGen:            CasesGenConfig{Batch: 5, LowMark: 3},
			QueueOpen:           true,
			Theme:               "ace_attorney",
			JudgeName:           "Судья",
			JudgeStyle:          "strict",
			DefenseSec:          20,
			TestimonySec:        25,
			SueThreshold:        5,
			SueWindowSec:        600,
			StreamerChance:      0.1,
			Articles:            []string{},
			Punishments:         []string{},
			StandbyIndictment:   "Суд разбирает бумаги. Заседание продолжается!",
			StandbyDeliberation: "Суд удаляется на совещание.",
			StandbyObjection:    "Протест принят. Суд продолжает!",
		},
		Safety: SafetyConfig{
			FilterEnabled:   true,
			BanConfirm:      true,
			CustomBlacklist: []string{},
			PanicHotkey:     "f12",
		},
		Game: GameConfig{
			StreamerName: "Стример",
			MemoryPath:   "data/memory.json",
			DonateToken:  "",
		},
		Prompts: DefaultPrompts(),
		Twitch: TwitchConfig{
			Channel: "",
			Nick:    "tribunal_bot",
			Token:   "",
		},
		Donations: DonationsConfig{
			RuleCurrency:   "RUB",
			WitnessEnabled: true,
			Token:          "",
			DefaultMin:     100,
			PlatinumMin:    500,
			MinAmounts:     map[string]float64{"RUB": 100, "USD": 2, "EUR": 2, "BITS": 200},
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
	// old config files without prompts inherit the strong bench
	defPrompts := DefaultPrompts()
	if cfg.Prompts.JudgeStrict == "" {
		cfg.Prompts.JudgeStrict = defPrompts.JudgeStrict
	}
	if cfg.Prompts.JudgeCynical == "" {
		cfg.Prompts.JudgeCynical = defPrompts.JudgeCynical
	}
	if cfg.Prompts.Prosecutor == "" {
		cfg.Prompts.Prosecutor = defPrompts.Prosecutor
	}
	if cfg.Prompts.Prosody == "" {
		cfg.Prompts.Prosody = defPrompts.Prosody
	}
	if cfg.Prompts.TaskIndictment == "" {
		cfg.Prompts.TaskIndictment = defPrompts.TaskIndictment
	}
	if cfg.Prompts.TaskCounter == "" {
		cfg.Prompts.TaskCounter = defPrompts.TaskCounter
	}
	if cfg.Prompts.TaskDeliberation == "" {
		cfg.Prompts.TaskDeliberation = defPrompts.TaskDeliberation
	}
	if cfg.Prompts.BribeNote == "" {
		cfg.Prompts.BribeNote = defPrompts.BribeNote
	}
	if cfg.Prompts.CondemnNote == "" {
		cfg.Prompts.CondemnNote = defPrompts.CondemnNote
	}
	if cfg.Prompts.GenPrompt == "" {
		cfg.Prompts.GenPrompt = defPrompts.GenPrompt
	}
	if cfg.Prompts.Confession == "" {
		cfg.Prompts.Confession = defPrompts.Confession
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
		cfg.TTS.SileroJudge = "kseniya"
	}
	// empty strings from yaml must not wipe the smart OS-aware defaults
	defTTS := DefaultConfig().TTS
	if cfg.TTS.PiperBinary == "" {
		cfg.TTS.PiperBinary = defTTS.PiperBinary
	}
	if cfg.TTS.ModelPath == "" {
		cfg.TTS.ModelPath = defTTS.ModelPath
	}
	if cfg.TTS.ConfigPath == "" {
		cfg.TTS.ConfigPath = defTTS.ConfigPath
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
	if cfg.Courtroom.JudgeStyle != "cynical" && cfg.Courtroom.JudgeStyle != "random" {
		cfg.Courtroom.JudgeStyle = "strict"
	}
	if cfg.Courtroom.DefenseSec <= 0 {
		cfg.Courtroom.DefenseSec = 20
	}
	if cfg.Courtroom.DefenseSec < 5 || cfg.Courtroom.DefenseSec > 120 {
		cfg.Courtroom.DefenseSec = 20
	}
	if cfg.Courtroom.TestimonySec <= 0 {
		cfg.Courtroom.TestimonySec = 25
	}
	if cfg.Courtroom.TestimonySec < 5 || cfg.Courtroom.TestimonySec > 120 {
		cfg.Courtroom.TestimonySec = 25
	}
	if cfg.Courtroom.SueThreshold < 0 {
		cfg.Courtroom.SueThreshold = 5
	}
	if cfg.Courtroom.SueWindowSec <= 0 {
		cfg.Courtroom.SueWindowSec = 600
	}
	if cfg.Courtroom.StreamerChance < 0 || cfg.Courtroom.StreamerChance > 1 {
		cfg.Courtroom.StreamerChance = 0.1
	}
	if cfg.Donations.StreamerTrialMin < 0 {
		cfg.Donations.StreamerTrialMin = 0
	}
	switch strings.ToLower(strings.TrimSpace(cfg.Safety.PanicHotkey)) {
	case "escape", "f9", "f12", "p":
		cfg.Safety.PanicHotkey = strings.ToLower(strings.TrimSpace(cfg.Safety.PanicHotkey))
	default:
		cfg.Safety.PanicHotkey = "escape"
	}

	return cfg, nil
}

func deepCopyMap(in map[string]any) map[string]any {
	out := make(map[string]any, len(in))
	for k, v := range in {
		out[k] = deepCopyValue(v)
	}
	return out
}

func deepCopyValue(v any) any {
	switch t := v.(type) {
	case map[string]any:
		return deepCopyMap(t)
	case []any:
		cp := make([]any, len(t))
		for i, e := range t {
			cp[i] = deepCopyValue(e)
		}
		return cp
	default:
		return v
	}
}

// Clone creates a deep copy for atomic RCU pointer swapping.
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
	if c.AI.ExtraBody != nil {
		out.AI.ExtraBody = deepCopyMap(c.AI.ExtraBody)
	}
	if c.Safety.CustomBlacklist != nil {
		out.Safety.CustomBlacklist = append([]string(nil), c.Safety.CustomBlacklist...)
	}
	if c.Safety.BribeWords != nil {
		out.Safety.BribeWords = append([]string(nil), c.Safety.BribeWords...)
	}
	return &out
}

// Save writes config to disk with 0600 permissions.
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
