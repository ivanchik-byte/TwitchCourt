import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTribunalWS, type Tribunal } from '../hooks/useTribunalWS'
import { apiGet, apiPost } from '../lib/api'
import type { PoolSeat } from '../lib/types'

interface TribunalContextValue {
  t: Tribunal
  pool: PoolSeat[]
  refreshDock: () => void
  gavel: () => void
  punish: (kind: string, secs?: number) => Promise<boolean>
  pick: (nick?: string) => Promise<void>
  skip: () => Promise<void>
  openTrial: (defendant: string, crime: string, viewer?: boolean) => Promise<void>
}

const TribunalContext = createContext<TribunalContextValue | null>(null)

export function TribunalProvider({ children }: { children: ReactNode }) {
  const t = useTribunalWS()
  const [pool, setPool] = useState<PoolSeat[]>([])

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
  useEffect(() => {
    void refreshDock()
  }, [t.phase, t.defendant, refreshDock])

  const gavel = useCallback(() => {
    t.send('gavel', {})
  }, [t])

  const punish = useCallback(
    async (kind: string, secs?: number) => apiPost('/api/punish', { kind, secs: secs ?? 0 }),
    [],
  )

  const pick = useCallback(
    async (nick?: string) => {
      await apiPost('/api/dock/pick', { nick: nick ?? '' })
      await refreshDock()
    },
    [refreshDock],
  )

  const skip = useCallback(async () => {
    await apiPost('/api/dock/skip', {})
    t.panicReset()
    await refreshDock()
  }, [refreshDock, t])

  const openTrial = useCallback(async (defendant: string, crime: string, viewer = true) => {
    if (!defendant.trim()) return
    await apiPost('/api/trial', { defendant: defendant.trim(), crime: crime || 'выбран залом', viewer })
  }, [])

  const value = useMemo(
    () => ({ t, pool, refreshDock, gavel, punish, pick, skip, openTrial }),
    [t, pool, refreshDock, gavel, punish, pick, skip, openTrial],
  )

  return <TribunalContext.Provider value={value}>{children}</TribunalContext.Provider>
}

export function useTribunal(): TribunalContextValue {
  const v = useContext(TribunalContext)
  if (!v) throw new Error('useTribunal must be used inside TribunalProvider')
  return v
}
