import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useTribunalWS, type Tribunal } from '../hooks/useTribunalWS'
import { apiGet, apiPost, apiNote, type ApiResult } from '../lib/api'
import type { PoolSeat } from '../lib/types'

export interface TribunalActions {
  refreshDock: () => void
  gavel: () => void
  panic: () => void
  punish: (kind: string, secs?: number) => Promise<ApiResult>
  pick: (nick?: string) => Promise<void>
  skip: () => Promise<void>
  openTrial: (defendant: string, crime: string, viewer?: boolean) => Promise<ApiResult>
}

const TribunalStateContext = createContext<Tribunal | null>(null)
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
      /* offline — keep last known pool */
    }
  }, [])

  useEffect(() => {
    void refreshDock()
    const id = setInterval(refreshDock, 15000)
    return () => clearInterval(id)
  }, [refreshDock])

  // queue follows the socket, not the poller: any phase/defendant change re-syncs
  const phase = t.phase
  const defendant = t.defendant
  useEffect(() => {
    void refreshDock()
  }, [phase, defendant, refreshDock])

  const gavel = useCallback(() => {
    // legacy gavel semantics: slam the desk, the judge speaks
    tRef.current.send('animation', { name: 'slam' })
    void (async () => {
      const r = await apiPost('/api/say', { text: 'Суд слушает!' })
      if (!r.ok) toast.error(`Молоток без голоса: ${apiNote(r.status)}`)
    })()
  }, [])

  const panic = useCallback(() => {
    tRef.current.send('panic', {})
    tRef.current.panicReset()
  }, [])

  const punish = useCallback(
    (kind: string, secs?: number) => apiPost('/api/punish', { kind, secs: secs ?? 0 }),
    [],
  )

  const pick = useCallback(
    async (nick?: string) => {
      const r = await apiPost('/api/dock/pick', { nick: nick ?? '' })
      if (!r.ok) toast.error(`Скамья: ${r.status === 401 ? 'проверь секретный ключ' : 'не вышло'}`)
      await refreshDock()
    },
    [refreshDock],
  )

  const skip = useCallback(async () => {
    await apiPost('/api/dock/skip', {})
    tRef.current.panicReset()
    await refreshDock()
  }, [refreshDock])

  const openTrial = useCallback(async (defendant: string, crime: string, viewer = true): Promise<ApiResult> => {
    if (!defendant.trim()) {
      toast.error('Впиши ник подсудимого')
      return { ok: false, status: 0 }
    }
    return apiPost('/api/trial', { defendant: defendant.trim(), crime: crime || 'выбран залом', viewer })
  }, [])

  const actions = useMemo<TribunalActions>(
    () => ({ refreshDock, gavel, panic, punish, pick, skip, openTrial }),
    [refreshDock, gavel, panic, punish, pick, skip, openTrial],
  )

  return (
    <TribunalStateContext.Provider value={t}>
      <TribunalPoolContext.Provider value={pool}>
        <TribunalActionsContext.Provider value={actions}>{children}</TribunalActionsContext.Provider>
      </TribunalPoolContext.Provider>
    </TribunalStateContext.Provider>
  )
}

export function useTribunalState(): Tribunal {
  const v = useContext(TribunalStateContext)
  if (!v) throw new Error('useTribunalState must be used inside TribunalProvider')
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
