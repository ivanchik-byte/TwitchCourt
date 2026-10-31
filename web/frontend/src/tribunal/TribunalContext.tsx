import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { toast } from 'sonner'
import { useTribunalWS, type StenogramEntry } from '../hooks/useTribunalWS'
import { apiGet, apiPost, apiNote } from '../lib/api'
import type { PoolSeat, VerdictPayload } from '../lib/types'

export interface TribunalPhase {
  trialId: number
  connected: boolean
  rttMs: number | null
  retries: number
  phase: string
  caseTitle: string
  defendant: string
  charge: string
  timeLeft: number | null
  verdict: VerdictPayload | null
  demo: boolean
  mode: 'viewer' | 'streamer' | 'unban'
}

export interface TribunalFeed {
  judgeLine: string
  stenogram: StenogramEntry[]
}

interface DefenseDraft {
  text: string
  setText: Dispatch<SetStateAction<string>>
}

export interface TribunalActions {
	refreshDock: () => Promise<void>
  gavel: () => void
  panic: () => void
}

const TribunalPhaseContext = createContext<TribunalPhase | null>(null)
const TribunalFeedContext = createContext<TribunalFeed | null>(null)
const TribunalPoolContext = createContext<PoolSeat[]>([])
const TribunalActionsContext = createContext<TribunalActions | null>(null)
const DefenseDraftContext = createContext<DefenseDraft | null>(null)

export function TribunalProvider({ children }: { children: ReactNode }) {
  const t = useTribunalWS()
  const [pool, setPool] = useState<PoolSeat[]>([])
  const [defenseDraft, setDefenseDraft] = useState<{ trialId: number; text: string } | null>(null)
  const tRef = useRef(t)
  tRef.current = t

  const trialId = t.trialId
  const setDefenseText = useCallback((value: SetStateAction<string>) => {
    setDefenseDraft(current => {
      if (tRef.current.trialId !== trialId || tRef.current.phase !== 'defense') return current
      const text = current?.trialId === trialId ? current.text : ''
      return { trialId, text: typeof value === 'function' ? value(text) : value }
    })
  }, [trialId])
  const defenseText = t.phase === 'defense' && defenseDraft?.trialId === trialId ? defenseDraft.text : ''
  const defense = useMemo(() => ({ text: defenseText, setText: setDefenseText }), [defenseText, setDefenseText])

  useEffect(() => {
    if (t.phase !== 'defense') setDefenseDraft(null)
  }, [t.phase, trialId])

  useEffect(() => {
    if (!defenseText.trim()) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [defenseText])

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
  const donationTick = t.stenogram.filter(entry => entry.kind === 'donation').slice(-1)[0]?.id
  useEffect(() => {
    void refreshDock()
  }, [phaseName, defendantName, donationTick, t.queueRevision, refreshDock])

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

  const actions = useMemo<TribunalActions>(() => ({ gavel, panic, refreshDock }), [gavel, panic, refreshDock])

  // split identity: stenogram ticks must not re-render phase consumers
  const phase = useMemo<TribunalPhase>(
    () => ({
      trialId: t.trialId,
      connected: t.connected,
      rttMs: t.rttMs,
      retries: t.retries,
      phase: t.phase,
      caseTitle: t.caseTitle,
      defendant: t.defendant,
      charge: t.charge,
      timeLeft: t.timeLeft,
      verdict: t.verdict,
      demo: t.demo,
      mode: t.mode,
    }),
    [t.trialId, t.connected, t.rttMs, t.retries, t.phase, t.caseTitle, t.defendant, t.charge, t.timeLeft, t.verdict, t.demo, t.mode],
  )
  const feed = useMemo<TribunalFeed>(
    () => ({ judgeLine: t.judgeLine, stenogram: t.stenogram }),
    [t.judgeLine, t.stenogram],
  )

  return (
    <TribunalPhaseContext.Provider value={phase}>
      <TribunalFeedContext.Provider value={feed}>
        <TribunalPoolContext.Provider value={pool}>
          <TribunalActionsContext.Provider value={actions}>
            <DefenseDraftContext.Provider value={defense}>{children}</DefenseDraftContext.Provider>
          </TribunalActionsContext.Provider>
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

export function useDefenseDraft(): DefenseDraft {
  const draft = useContext(DefenseDraftContext)
  if (!draft) throw new Error('useDefenseDraft must be used inside TribunalProvider')
  return draft
}
