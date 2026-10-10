import { toast } from 'sonner'
import { apiNote } from '../../lib/api'

export const inputCls =
  'mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm text-white outline-none focus:border-amber-400/50'
export const labelCls = 'block text-xs text-zinc-400'

export function roundTemp(v: number): number {
  return Number(v.toFixed(2))
}

export function lines(v: string): string[] {
  return v
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

export async function saveSection(name: string, fn: () => Promise<{ ok: boolean; status: number }>) {
  try {
    const r = await fn()
    if (r.ok) toast.success(`${name}: сохранено`)
    else toast.error(`${name}: ${apiNote(r.status)}`)
  } catch {
    toast.error(`${name}: ошибка сети`)
  }
}

export function SaveButton({ onSave }: { onSave: () => void }) {
  return (
    <button
      onClick={onSave}
      className="pressable rounded-lg bg-amber-400/90 px-4 py-1.5 text-sm font-bold text-black"
    >
      Сохранить
    </button>
  )
}

export interface AiState {
  provider: string
  model: string
  temperature: number
  baseUrl: string
  extraBody: string
}

export interface TtsState {
  engine: string
  voice: string
  customVoice: string
  sileroJudge: string
  rate: string
  volume: string
  pitch: string
  judgeVoice: string
  judgeRate: string
  sileroUrl: string
  enabled: boolean
  autoFallback: boolean
  piperBinary: string
  modelPath: string
  configPath: string
  speakerId: string
  speed: string
  beep: boolean
}

export interface TwitchState {
  channel: string
  nick: string
  token: string
  clientId: string
  broadcasterId: string
  moderatorId: string
  daToken: string
  dpKey: string
  daEnabled: boolean
  dpEnabled: boolean
  bitsEnabled: boolean
}

export interface ProfileState {
  name: string
  mercy: string
  titles: string
  traits: string
  gags: string
  notes: string
}

export interface SafetyState {
  filterEnabled: boolean
  blacklist: string
  panicHotkey: string
  banConfirm: boolean
}

export interface VoiceLists {
  edge: string[]
  silero: string[]
}
