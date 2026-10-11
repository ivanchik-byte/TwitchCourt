import { useCallback } from 'react'
import { toast } from 'sonner'
import { useTribunalActions } from '../../tribunal/TribunalContext'
import { apiNote } from '../../lib/api'

export function useBan() {
  const { punish } = useTribunalActions()

  return useCallback(async () => {
    if (!window.confirm('Заблокировать навсегда? Это необратимо для чата.')) return
    const r = await punish('ban')
    if (!r.ok) {
      toast.error(`Блокировка не применена: ${apiNote(r.status)}`)
      return
    }
    toast('Пользователь заблокирован', {
      duration: 5000,
      action: { label: 'Отменить', onClick: () => void punish('pardon') },
    })
  }, [punish])
}

export function usePunishWithToast() {
  const { punish } = useTribunalActions()

  return useCallback(
    async (kind: string, secs?: number) => {
      const r = await punish(kind, secs)
      if (!r.ok) toast.error(`Наказание не применено: ${apiNote(r.status)}`)
      return r
    },
    [punish],
  )
}
