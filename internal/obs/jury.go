package obs

type JuryRound struct {
	ID         string `json:"id"`
	Number     int    `json:"number"`
	Status     string `json:"status"`
	ClosesAtMS int64  `json:"closes_at_ms,omitempty"`
	Total      int    `json:"total"`
	Guilty     *int   `json:"guilty,omitempty"`
	Innocent   *int   `json:"innocent,omitempty"`
}

type JuryComparison struct {
	Compared int `json:"compared"`
	Changed  int `json:"changed"`
}

type JuryPayload struct {
	Epoch      string          `json:"epoch"`
	Revision   uint64          `json:"revision"`
	TrialID    uint64          `json:"trial_id"`
	Demo       bool            `json:"demo"`
	CanFirst   bool            `json:"can_first"`
	CanSecond  bool            `json:"can_second"`
	OpenRound  int             `json:"open_round"`
	First      *JuryRound      `json:"first,omitempty"`
	Second     *JuryRound      `json:"second,omitempty"`
	Comparison *JuryComparison `json:"comparison,omitempty"`
}
