import { useEffect, useState } from 'react'
import { Check, FilePlus2 } from 'lucide-react'
import { apiGet, apiPostJson } from '../../lib/api'

interface TrialExhibits {
  trial_id: number
  exhibits?: { index: number; title: string; text: string; revealed: boolean }[]
}

export function ExhibitDesk({ phase, connected, blocked }: { phase: string; connected: boolean; blocked: boolean }) {
  const [trial, setTrial] = useState<TrialExhibits | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const status = await apiGet<{ trial: TrialExhibits }>('/api/status')
        if (active) {
          setTrial(current => current?.trial_id === status.trial.trial_id ? {
            ...status.trial,
            exhibits: status.trial.exhibits?.map(entry => ({ ...entry, revealed: entry.revealed || !!current.exhibits?.some(previous => previous.index === entry.index && previous.revealed) })),
          } : status.trial)
          setError('')
          setLoading(false)
        }
      } catch { if (active) { setLoading(false); setError('Не удалось загрузить улики.') } }
    }
    setLoading(true)
    void refresh()
    const sync = () => { void refresh() }
    window.addEventListener('tribunal-exhibit', sync)
    return () => { active = false; window.removeEventListener('tribunal-exhibit', sync) }
  }, [phase, connected])

  if (!trial?.exhibits?.length) return error ? <p className="panel-error" role="alert">{error}</p> : null
  const closed = phase === 'jury' || phase === 'deliberation' || phase === 'verdict'
  return <section className="desk-panel exhibit-desk">
    <h2>Дополнительная улика</h2>
    <p>Выберите момент после первого аргумента. Суд и зрители увидят улику только после приобщения.</p>
    {trial.exhibits.map(exhibit => <div className="exhibit-entry" key={exhibit.index}>
      <details><summary>{exhibit.title}</summary><p>{exhibit.text}</p></details>
      <button className="secondary-action" disabled={exhibit.revealed || closed || blocked || loading || pending !== null || !connected} onClick={async () => {
        setPending(exhibit.index)
        setError('')
        const response = await apiPostJson('/api/trial/exhibit', { trial_id: trial.trial_id, index: exhibit.index })
        if (response.ok) setTrial(current => current && current.trial_id === trial.trial_id ? { ...current, exhibits: current.exhibits?.map(entry => entry.index === exhibit.index ? { ...entry, revealed: true } : entry) } : current)
        else setError(response.status === 409 ? 'Это дело уже не принимает новые материалы.' : 'Улика не приобщена. Проверьте связь и ключ доступа.')
        setPending(null)
      }}>{exhibit.revealed ? <Check size={13} /> : <FilePlus2 size={13} />}{exhibit.revealed ? 'Приобщена' : pending === exhibit.index ? 'Приобщаем…' : 'Приобщить к делу'}</button>
    </div>)}
    {closed && <p>{phase === 'jury' ? 'Материалы закрыты. Дальше мнение присяжных и вердикт.' : 'Суд уже принимает решение. Новые материалы в это дело не добавляются.'}</p>}
    {blocked && <p>Сначала закройте первое мнение присяжных.</p>}
    {error && <p className="panel-error" role="alert">{error}</p>}
  </section>
}
