package obs

type EventType string

const (
	EventStateChange  EventType = "state_change"
	EventAudioChunk   EventType = "audio_chunk"
	EventAnimation    EventType = "animation"
	EventSubtitles    EventType = "subtitles"
	EventVerdict      EventType = "verdict"
	EventPanic        EventType = "panic"
	EventDonation     EventType = "donation"
	EventTestimony    EventType = "testimony"
	EventQueueChanged EventType = "queue_change"
)

type EventMessage struct {
	Type    EventType   `json:"type"`
	Payload interface{} `json:"payload"`
}

type StateChangePayload struct {
	State       string          `json:"state"`
	CaseTitle   string          `json:"case_title,omitempty"`
	Defendant   string          `json:"defendant,omitempty"`
	Charge      string          `json:"charge,omitempty"`
	TimeLeftSec int             `json:"time_left_sec,omitempty"`
	Demo        bool            `json:"demo"`
	Mode        string          `json:"mode,omitempty"`
	Line        string          `json:"line,omitempty"`
	Verdict     *VerdictPayload `json:"verdict,omitempty"`
}

type AudioChunkPayload struct {
	Index       int    `json:"index"`
	AudioBase64 string `json:"audio_base64"`
	Text        string `json:"text"`
	IsLast      bool   `json:"is_last"`
}

type AnimationPayload struct {
	Name     string `json:"name"`
	Duration int    `json:"duration_ms,omitempty"`
}

type SubtitlesPayload struct {
	Speaker string `json:"speaker"`
	Text    string `json:"text"`
}

type TestimonyPayload struct {
	Author string `json:"author"`
	Text   string `json:"text"`
}

type DonationPayload struct {
	ID         uint64  `json:"id"`
	Action     string  `json:"action"`
	Note       string  `json:"note"`
	At         string  `json:"at"`
	Donor      string  `json:"donor"`
	Amount     float64 `json:"amount"`
	Currency   string  `json:"currency"`
	Message    string  `json:"message,omitempty"`
	OpensTrial bool    `json:"opens_trial"`
}

type VerdictPayload struct {
	Verdict     string `json:"verdict"`
	GuiltyVotes int    `json:"guilty_votes"`
	TotalVotes  int    `json:"total_votes"`
	Witnesses   int    `json:"witnesses,omitempty"`
	Penalty     string `json:"penalty,omitempty"`
	Twist       string `json:"twist,omitempty"`
}
