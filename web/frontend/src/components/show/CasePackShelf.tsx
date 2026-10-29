import { useEffect, useState } from 'react'
import { apiGet, apiPostJson } from '../../lib/api'

interface PackSummary {
  id: string
  title: string
  description: string
  titles: string[]
  installed: number
}

export function CasePackShelf({ onImport }: { onImport: () => Promise<void> }) {
  const [packs, setPacks] = useState<PackSummary[]>([])
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void apiGet<{ packs: PackSummary[] }>('/api/cases/packs').then(({ packs }) => { if (active) setPacks(packs) }).catch(() => { if (active) setError('Не удалось загрузить готовые колоды.') })
    return () => { active = false }
  }, [])

  return <details className="case-pack-shelf">
    <summary>Готовые колоды для вечера <span>{packs.length ? `${packs.length} набор` : ''}</span></summary>
    {packs.map(pack => <div className="case-pack" key={pack.id}>
      <div><h2>{pack.title}</h2><p>{pack.description}</p><ol>{pack.titles.map(title => <li key={title}>{title}</li>)}</ol></div>
      <div className="case-pack-actions"><span>{pack.installed} из {pack.titles.length} уже в колоде</span><button className="primary-action" disabled={pending || pack.installed === pack.titles.length} onClick={async () => {
        setPending(true)
        setError('')
        const response = await apiPostJson<{ added: number; skipped: number }>('/api/cases/packs', { id: pack.id })
        if (response.ok && response.data) {
          setPacks(current => current.map(entry => entry.id === pack.id ? { ...entry, installed: entry.titles.length } : entry))
          setNotice(`Добавлено дел: ${response.data.added}. Ваши дела и правки сохранены.`)
          await onImport()
        } else setError('Колода не добавлена. Проверьте связь с сервером и ключ доступа.')
        setPending(false)
      }}>{pending ? 'Добавляем…' : pack.installed === pack.titles.length ? 'Все дела добавлены' : 'Добавить в мою колоду'}</button></div>
    </div>)}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="panel-error">{error}</p>}
  </details>
}
