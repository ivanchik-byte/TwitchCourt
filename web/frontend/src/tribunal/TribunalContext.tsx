import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useTribunalWS, type StenogramEntry } from '../hooks/useTribunalWS'
import { apiGet, apiPost, apiNote, type ApiResult } from '../lib/api'
import type { PoolSeat, VerdictPayload } from '../lib/types'

export interface TribunalPhase {
  connected: boolean
  rttMs: number | null
  retries: number
  phase: string
  caseTitle: string
  defendant: string
  charge: string
  timeLeft: number | null
  verdict: VerdictPayload | null
}

export interface TribunalFeed {
  judgeLine: string
  stenogram: StenogramEntry[]
}

export interface TribunalActions {
  refreshDock: () => void
  gavel: () => void
  panic: () => void
  punish: (kind: string, secs?: number) => Promise<ApiResult>
  pick: (nick?: string) => Promise<void>
  skip: () => Promise<void>
  openTrial: (defendant: string, crime: string, viewer?: boolean) => Promise<ApiResult>
  send: (action: string, payload?: Record<string, unknown>) => boolean
}

const TribunalPhaseContext = createContext<TribunalPhase | null>(null)
const TribunalFeedContext = createContext<TribunalFeed | null>(null)
const TribunalPoolContext = createContext<PoolSeat[]>([])
const TribunalActionsContext = createContext<TribunalActions | null>(null)

export function TribunalProvider({ children }: { children: ReactNode }) {
  const t = useTribunalWS()
  const [pool, setPool] = useState<PoolSeat[]>([])
  const tRef = useRef(t)
  tRef.current = t

  const refreshDock = useCallback(async () => {
    try {
      const d = await apiGet<{ pool: PoolSeat[] }>('/api/dock')
      setPool(d.pool ?? [])
    } catch {
      /* offline: keep last known pool */
    }
  }, [])

  useEffect(() => {
    void refreshDock()
    const id = setInterval(refreshDock, 15000)
    return () => clearInterval(id)
  }, [refreshDock])

  // queue follows socket events: phase or defendant updates trigger dock refresh
  const phaseName = t.phase
  const defendantName = t.defendant
  useEffect(() => {
    void refreshDock()
  }, [phaseName, defendantName, refreshDock])

  const gavel = useCallback(() => {
    // trigger gavel desk slam animation and vocal interjection
    tRef.current.send('animation', { name: 'slam' })
    void (async () => {
      const r = await apiPost('/api/say', { text: 'Суд слушает.' })
      if (!r.ok) toast.error(`Озвучка недоступна: ${apiNote(r.status)}`)
    })()
  }, [])

  const panic = useCallback(() => {
    // server echo clears the UI on receipt; REST fallback covers a dead socket
    if (tRef.current.send('panic', {})) return
    void (async () => {
      const r = await apiPost('/api/panic', {})
      if (r.ok) tRef.current.panicReset()
      else toast.error(`Паника не прошла: ${apiNote(r.status)}`)
    })()
  }, [])

  const punish = useCallback(
    (kind: string, secs?: number) => apiPost('/api/punish', { kind, secs: secs ?? 0 }),
    [],
  )

  const pick = useCallback(
    async (nick?: string) => {
      const r = await apiPost('/api/dock/pick', { nick: nick ?? '' })
      if (!r.ok) toast.error(`Скамья: ${r.status === 401 ? 'проверьте секретный ключ' : 'операция не выполнена'}`)
      await refreshDock()
    },
    [refreshDock],
  )

  const skip = useCallback(async () => {
    const r = await apiPost('/api/dock/skip', {})
    if (!r.ok) {
      toast.error(`Пропуск не удался: ${apiNote(r.status)}`)
      return
    }
    tRef.current.panicReset()
    await refreshDock()
  }, [refreshDock])

  const openTrial = useCallback(async (defendant: string, crime: string, viewer = true): Promise<ApiResult> => {
    if (!defendant.trim()) {
      toast.error('Укажите никнейм подсудимого')
      return { ok: false, status: 0 }
    }
    return apiPost('/api/trial', { defendant: defendant.trim(), crime: crime || '', viewer })
  }, [])

  const send = useCallback((action: string, payload: Record<string, unknown> = {}) => {
    return tRef.current.send(action, payload)
  }, [])

  const actions = useMemo<TribunalActions>(
    () => ({ refreshDock, gavel, panic, punish, pick, skip, openTrial, send }),
    [refreshDock, gavel, panic, punish, pick, skip, openTrial, send],
  )

  // split identity: stenogram ticks must not re-render phase consumers
  const phase = useMemo<TribunalPhase>(
    () => ({
      connected: t.connected,
      rttMs: t.rttMs,
      retries: t.retries,
      phase: t.phase,
      caseTitle: t.caseTitle,
      defendant: t.defendant,
      charge: t.charge,
      timeLeft: t.timeLeft,
      verdict: t.verdict,
    }),
    [t.connected, t.rttMs, t.retries, t.phase, t.caseTitle, t.defendant, t.charge, t.timeLeft, t.verdict],
  )
  const feed = useMemo<TribunalFeed>(
    () => ({ judgeLine: t.judgeLine, stenogram: t.stenogram }),
    [t.judgeLine, t.stenogram],
  )

  return (
    <TribunalPhaseContext.Provider value={phase}>
      <TribunalFeedContext.Provider value={feed}>
        <TribunalPoolContext.Provider value={pool}>
          <TribunalActionsContext.Provider value={actions}>{children}</TribunalActionsContext.Provider>
        </TribunalPoolContext.Provider>
      </TribunalFeedContext.Provider>
    </TribunalPhaseContext.Provider>
  )
}

export function useTribunalPhase(): TribunalPhase {
  const v = useContext(TribunalPhaseContext)
  if (!v) throw new Error('useTribunalPhase must be used inside TribunalProvider')
  return v
}

export function useTribunalFeed(): TribunalFeed {
  const v = useContext(TribunalFeedContext)
  if (!v) throw new Error('useTribunalFeed must be used inside TribunalProvider')
  return v
}

export function useTribunalPool(): PoolSeat[] {
  return useContext(TribunalPoolContext)
}

export function useTribunalActions(): TribunalActions {
  const v = useContext(TribunalActionsContext)
  if (!v) throw new Error('useTribunalActions must be used inside TribunalProvider')
  return v
}
