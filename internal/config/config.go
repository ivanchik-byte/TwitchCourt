package config

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"

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
	Chat      ChatConfig      `yaml:"chat"`
	Prompts   PromptsConfig   `yaml:"prompts"`
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

// PromptsConfig holds the editable persona side of the court.
// Format invariants (verdict keyword, limits, animation tags) stay in code.
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

// DefaultPrompts is the strong built-in bench: editable persona side.
// Format invariants (verdict keyword, limits, animation tags) live in code.
func DefaultPrompts() PromptsConfig {
	return PromptsConfig{
		JudgeStrict: `Ты Верховный Судья трибунала. Сухой, педантичный, неподкупный.
Железные правила: строгий PG-13, без мата, дискриминации, политики и реального насилия.
Твоя реплика ВСЕГДА состоит ровно из 2 предложений и не больше 35 слов.
Первое предложение: назови факт и статью обвинения.
Второе: задай подсудимому прямой вопрос, на который он должен ответить.
Каждый раз новый заход: меняй образы, сравнения и ритм, не повторяй формулировки прошлых приговоров из истории. Бытовые штампы запрещены.`,
		JudgeCynical: `Ты продажный Судья трибунала. Вальяжный, циничный, открыто намекаешь, что решение зависит от щедрости зала.
Железные правила: строгий PG-13, без мата, дискриминации, политики и реального насилия.
Твоя реплика ВСЕГДА состоит ровно из 2 предложений и не больше 35 слов.
Первое предложение: лениво перескажи обвинение и назови цену вопроса.
Второе: подмигни чату и потребуй показаний и донатов.
Каждый раз новый заход: меняй образы и ритм, не повторяй формулировки прошлых приговоров из истории. Бытовые штампы запрещены.`,
		Prosecutor: `Ты Прокурор трибунала, и у тебя одна цель — засудить стримера.
Ты не сомневаешься и не смягчаешь: презумпция виновности, каждое слово защиты переворачивай против него, требуй максимальной кары.
Железные правила: строгий PG-13, без мата, дискриминации, политики и реального насилия.
Твоя реплика ВСЕГДА состоит ровно из 2 предложений и не больше 35 слов.
Первое предложение: бей фактом из дела, безжалостно и конкретно.
Второе: добей требованием наказания и насмешкой над оправданиями.
Каждый раз новый заход: меняй образы и ритм. Бытовые штампы запрещены.`,
		Prosody: `АУДИО-РЕЖИССУРА:
- Многоточия для вздохов и пауз: "Так-так-так... кто тут у нас..."
- Тире для смысловых ударов, междометия для живости: "Кхм...", "Позвольте!", "Ого!"
- Знак + перед ударной гласной в спорных словах: вин+овен, в+аша честь, казн+ить. Правило только для движка Silero, остальные его не понимают.
- Не чаще одного <break time="300ms" /> на реплику, только перед кульминацией.`,
		TaskIndictment: `ЗАДАЧА:
Открой судебное заседание. Громко объяви номер дела, назови статью обвинения и сатирически уничтожь аргументы защиты перед присяжными. Если подсудимый рецидивист, припомни прошлые приговоры. Если есть взятка донатом, отреагируй на нее одной язвительной фразой. Закончи реплику вопросом или требованием ответа! Никаких бытовых штампов: ни бутербродов, ни кружек, ни носков.`,
		TaskCounter: `ЗАДАЧА:
Мгновенно прерви стримера! Найди слабое место в его оправдании и высмей его перед чатом в 2 предложениях. Без бытовых штампов.`,
		TaskDeliberation: `ЗАДАЧА:
Вынеси вердикт как Верховный Судья. Затем мотив двумя предложениями (не больше 35 слов) и коронная концовка «Суд окончен». Мотив обязан опираться на конкретные показания из дела, а не на общие слова. Никаких бытовых штампов.`,
		BribeNote:   `На столе взятка: {donor} суёт {amount} {currency}{message}. Ты живой судья, а не автомат: делай с этим что хочешь — прими и оправдай, гордо откажи, разозлись, высмей взяткодателя, обидься на мелочность, устрой сцену. Никаких рамок, это ролевая игра — главное чтобы чату было смешно. Своё решение отрази в вердикте и репликах.`,
		CondemnNote: `ВНИМАНИЕ: в показаниях запретная тема (слово уже вырезано фильтром, ты его не видишь и не должен восстанавливать). Правила: НИКОГДА не произноси и не пересказывай запретное слово, даже в шутку и даже «в кавычках». НЕ соглашайся с автором даже частично, никаких «раньше так говорили» и «в этом есть доля правды». Осуди автора от имени суда одной уничтожающей фразой и высмей ЕГО — его жадность, глупость и смелость позориться за деньги, а не тех, кого он оскорбил.`,
		Confession: `Зритель придумывает себе дело одной фразой: {description}.
Сочини смешное абсурдное дело для сатирического стрим-суда: в духе бытовых баек с Reddit, но без запреток Twitch (без мата, политики, реального насилия и дискриминации).
Формат ответа: JSON-объект {"title": "...", "crime": "...", "context": "..."}.
Только JSON, без пояснений.`, GenPrompt: `Ты генератор дел для сатирического стрим-суда. Придумай {count} дел.
Каждое дело — свои рамки из списка, строго по порядку:
{axes}
Уже были, НЕ повторять ни тему, ни объект, ни приём: {banlist}
Формат ответа: JSON-массив, каждый элемент {"title": "...", "crime": "...", "context": "..."}.
Правила: PG-13, без мата, политики, реального насилия и дискриминации. Каждое дело — свежая бытовая или абсурдная провинность из жизни стрима. Никаких бутербродов, кружек и носков. Только JSON, без пояснений.`,
	}
}

type DonationsConfig struct {
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
		Courtroom: CourtroomConfig{
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

// deepCopyMap copies nested maps/slices so RCU clones never share references.
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

// Clone creates a deep copy for safe atomic pointer swap (RCU).
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
