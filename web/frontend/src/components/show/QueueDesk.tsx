import { useEffect, useState } from 'react'
import { ArrowRight, X } from 'lucide-react'
import { apiFetch, apiGet, apiPost, apiPut } from '../../lib/api'
import type { PoolSeat } from '../../lib/types'
import { useTribunalActions, useTribunalPool } from '../../tribunal/TribunalContext'

export function QueueDesk({ onSelect, active }: { onSelect: (seat: PoolSeat) => void; active: boolean }) {
  const pool = useTribunalPool()
  const { refreshDock } = useTribunalActions()
  const [open, setOpen] = useState(true)
  const [nick, setNick] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let mounted = true
    void apiGet<{ queue_open: boolean }>('/api/settings').then(rules => { if (mounted) setOpen(rules.queue_open) }).catch(() => { if (mounted) setError('Не удалось проверить состояние очереди.') })
    return () => { mounted = false }
  }, [])

  return <details className="queue-disclosure" open={!active}><summary>Очередь <span>{pool.length} / 50{!open ? ' · вход закрыт' : ''}</span></summary><section className="desk-panel queue-panel"><div className="panel-heading"><h2>Вход в очередь</h2><button disabled={pending} className="queue-toggle" onClick={async () => {
    setPending(true)
    const response = await apiPut('/api/settings', { queue_open: !open })
    if (response.ok) { setOpen(!open); setError('') } else setError('Не удалось изменить очередь.')
    setPending(false)
  }}>{open ? 'Закрыть вход' : 'Открыть вход'}</button></div><p>{open ? 'Вход по !court. Приоритетные заявки идут первыми.' : 'Новые участники не принимаются. Текущая очередь сохранена.'}</p>
    {pool.length > 0 && <button className="secondary-action queue-next" disabled={active} onClick={() => onSelect(pool[0])}>Выбрать следующего<ArrowRight size={13} /></button>}
    <div className="queue-list">{pool.map((seat, index) => <div className="queue-entry" key={seat.nick}><button className="queue-seat" disabled={active} onClick={() => onSelect(seat)}><span className="queue-position">{index+1}</span><span>{seat.nick}<small>{seat.priority ? 'Приоритет · ' : ''}{seat.reason || 'Дело выберет ведущий'}</small></span></button><button aria-label={`Убрать ${seat.nick} из очереди`} disabled={pending} onClick={async () => {
      setPending(true)
      try {
        const response = await apiFetch('/api/dock/entry', { method: 'DELETE', body: JSON.stringify({ nick: seat.nick }) })
        if (!response.ok) setError('Не удалось убрать участника.')
        else { setError(''); await refreshDock() }
      } catch { setError('Нет связи с сервером.') }
      setPending(false)
    }}><X size={13} /></button></div>)}</div>
    {!pool.length && <p className="queue-empty">Пока никто не записался.</p>}
    <form className="queue-add" onSubmit={async event => {
      event.preventDefault()
      setPending(true)
      const response = await apiPost('/api/dock/entry', { nick: nick.trim(), reason: '' })
      if (response.ok) { setNick(''); setError(''); await refreshDock() }
      else setError(response.status === 400 ? 'Нужен Twitch-ник: 3–25 латинских букв, цифр или знак _.' : 'Очередь закрыта, заполнена или недоступна.')
      setPending(false)
    }}><label className="sr-only" htmlFor="queue-nick">Добавить участника</label><input id="queue-nick" value={nick} onChange={event => setNick(event.target.value)} placeholder="Twitch-ник" maxLength={25} disabled={!open || pending} /><button disabled={!open || !nick.trim() || pending}>Добавить</button></form>
    {error && <p className="panel-error" role="alert">{error}</p>}
  </section></details>
}
