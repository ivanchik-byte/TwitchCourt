export type TribunalEventType =
  | 'state_change'
  | 'audio_chunk'
  | 'animation'
  | 'subtitles'
  | 'verdict'
  | 'panic'
  | 'donation'
  | 'testimony'

export interface StateChangePayload {
  state: string
  case_title?: string
  defendant?: string
  charge?: string
  time_left_sec?: number
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
}

export interface TestimonyPayload {
  author: string
  text: string
}

export interface DonationPayload {
  donor: string
  amount: number
  currency: string
  message?: string
  opens_trial: boolean
}

export interface PoolSeat {
  nick: string
  reason: string
}

export interface UnbanRequest {
  id: string
  user: string
  text: string
  created_at: string
  messages?: string[]
}
