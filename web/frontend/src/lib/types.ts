export type TribunalEventType =
  | 'state_change'
  | 'audio_chunk'
  | 'animation'
  | 'subtitles'
  | 'verdict'
  | 'panic'
  | 'donation'
  | 'testimony'
  | 'queue_change'
  | 'appearance_change'
  | 'exhibit'
  | 'jury'

export interface JuryRound {
  id: string
  number: number
  status: 'open' | 'closed'
  closes_at_ms?: number
  total: number
  guilty?: number
  innocent?: number
}

export interface JuryStatus {
  epoch: string
  revision: number
  trial_id: number
  demo: boolean
  can_first: boolean
  can_second: boolean
  open_round: number
  first?: JuryRound
  second?: JuryRound
  comparison?: { compared: number; changed: number }
}

export interface AppealState { id: string; resolved: boolean; approved: boolean }

export interface StateChangePayload {
  appeal?: AppealState
  trial_id?: number
  state: string
  case_title?: string
  defendant?: string
  charge?: string
  time_left_sec?: number
  demo?: boolean
  mode?: 'viewer' | 'streamer' | 'unban'
  line?: string
  full_line?: string
  verdict?: VerdictPayload
}

export interface VerdictPayload {
  verdict: string
  guilty_votes: number
  total_votes: number
  witnesses?: number
  penalty?: string
  twist?: string
}

export interface SubtitlesPayload {
  speaker: string
  text: string
  full_line?: string
}

export interface TestimonyPayload {
  author: string
  text: string
}

export interface DonationPayload {
	 id: number
	 action: string
	 note: string
	 at: string
  donor: string
  amount: number
  currency: string
  message?: string
  opens_trial: boolean
}

export interface PoolSeat {
	priority: boolean
  nick: string
  reason: string
}

export interface UnbanRequest {
  id: string
  user: string
  user_login?: string
  text: string
  created_at: string
}
