import { useCallback } from 'react'
import { toast } from 'sonner'
import { useTribunalActions } from '../../tribunal/TribunalContext'
import { apiNote } from '../../lib/api'

export function useBan() {
  const { punish } = useTribunalActions()

  return useCallback(async () => {
    const r = await punish('ban')
    if (!r.ok) {
      toast.error(`Бан не выдан: ${apiNote(r.status)}`)
      return
    }
    toast('Бан выдан', {
      duration: 5000,
      action: { label: 'Отмена', onClick: () => void punish('pardon') },
    })
  }, [punish])
}

export function usePunishWithToast() {
  const { punish } = useTribunalActions()

  return useCallback(
    async (kind: string, secs?: number) => {
      const r = await punish(kind, secs)
      if (!r.ok) toast.error(`Кара не выставлена: ${apiNote(r.status)}`)
      return r
    },
    [punish],
  )
}
