import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Plus, Search, Shuffle, Trash2 } from 'lucide-react'
import { apiFetch, apiGet, apiNote, apiPost, apiPostJson, apiPut } from '../lib/api'
import type { ShowCase } from '../lib/show'

const emptyCase: ShowCase = { id: '', title: '', crime: '', context: '', details: '', defense_example: '' }

export function CasesView() {
  const navigate = useNavigate()
  const [cards, setCards] = useState<ShowCase[]>([])
  const [remaining, setRemaining] = useState(0)
  const [selected, setSelected] = useState<ShowCase | null>(null)
  const [editing, setEditing] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [generating, setGenerating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const deck = await apiGet<{ cases: ShowCase[]; remaining: number }>('/api/cases')
      setCards(deck.cases)
      setRemaining(deck.remaining)
      setError('')
    } catch { setError('Не удалось загрузить колоду. Проверьте сервер и ключ доступа.') }
  }, [])
  useEffect(() => {
    void refresh()
    void apiGet<{ running: boolean }>('/api/cases/generate').then(job => setGenerating(job.running)).catch(() => setError('Не удалось проверить генератор дел.'))
  }, [refresh])
  useEffect(() => {
    if (!generating) return
    let mounted = true
    const timer = setInterval(() => {
      void apiGet<{ running: boolean; error?: string }>('/api/cases/generate').then(job => {
        if (!mounted) return
        if (!job.running) { setGenerating(false); if (job.error) setError(job.error); else void refresh() }
      }).catch(() => { if (mounted) { setGenerating(false); setError('Потеряна связь с генератором.') } })
    },2000)
    return () => { mounted = false; clearInterval(timer) }
  }, [generating,refresh])

  const visible = cards.filter(card => (filter === 'all' || (filter === 'unused' ? !card.used : card.used)) && `${card.title} ${card.crime}`.toLowerCase().includes(query.toLowerCase()))
  const available = cards.filter(card => !card.used)
  const select = (card: ShowCase) => { setSelected(card); setEditing(false); setConfirmDelete(false) }

  return <div className="deck-workbench">
    <div className="desk-heading"><div className="workspace-title"><h1>Колода дел</h1><span>{remaining} не сыграно · всего {cards.length}</span></div><Link className="quiet-link" to="/settings?section=rules">Правила и автопополнение<ArrowRight size={13} /></Link></div>
    <div className="deck-toolbar"><div className="deck-search"><Search size={14} /><input aria-label="Поиск дел" value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти дело или обвинение" /></div><select aria-label="Статус дел" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Все дела</option><option value="unused">Не сыграно</option><option value="used">Сыграно</option></select><button className="secondary-action" disabled={!available.length || editing} onClick={() => select(available[Math.floor(Math.random()*available.length)])}><Shuffle size={13} /> Выбрать случайное</button><button className="secondary-action" disabled={pending} onClick={() => { setSelected(emptyCase); setEditing(true); setConfirmDelete(false) }}><Plus size={14} /> Новое дело</button><button className="secondary-action" disabled={generating || pending} onClick={async () => {
      setPending(true)
      const response = await apiPost('/api/cases/generate', { count: 5 })
      if (response.ok) { setGenerating(true); setError('') } else setError(response.status === 409 ? 'Генератор уже работает.' : apiNote(response.status))
      setPending(false)
    }}>{generating ? 'Генерируем…' : 'Сгенерировать 5 дел'}</button></div>
    {error && <p className="desk-error" role="alert">{error}</p>}
    <div className="deck-layout"><section className="deck-list" aria-label="Список дел"><div className="deck-list-heading"><span>Дело</span><span>Статус</span></div>{visible.length ? visible.map(card => <button key={card.id} className={`deck-row ${selected?.id === card.id ? 'is-selected' : ''}`} aria-pressed={selected?.id === card.id} onClick={() => select(card)}><span><strong>{card.title}</strong><small>{card.crime}</small></span><span className="case-state">{card.used ? 'Сыграно' : 'В колоде'}</span></button>) : <p className="deck-empty">{cards.length ? 'По этому запросу дел нет.' : 'Колода пуста. Добавьте своё дело или запустите генерацию.'}</p>}<div className="deck-list-footer"><button disabled={pending || !cards.length} onClick={async () => {
      setPending(true)
      const response = await apiPost('/api/cases/reset', {})
      if (response.ok) { await refresh(); setSelected(null) } else setError(apiNote(response.status))
      setPending(false)
    }}>Вернуть сыгранные дела в колоду</button></div></section>
    <section className="deck-inspector" aria-label="Материалы выбранного дела">{selected ? editing ? <form className="settings-panel" onSubmit={async event => {
      event.preventDefault()
      setPending(true)
      const fields = { title: selected.title.trim(), crime: selected.crime.trim(), context: selected.context || '', details: selected.details || '', defense_example: selected.defense_example || '' }
      const response = selected.id ? await apiPut('/api/cases', { ...fields, id: selected.id }) : await apiPostJson<ShowCase>('/api/cases', { title: fields.title, crime: fields.crime, context: fields.context })
      if (response.ok) { setEditing(false); setSelected(null); await refresh() } else setError('Не удалось сохранить дело. Проверьте название, обвинение и связь с сервером.')
      setPending(false)
    }}><h2>{selected.id ? 'Изменить дело' : 'Новое дело'}</h2><label>Название<input value={selected.title} required maxLength={120} onChange={event => setSelected({ ...selected,title:event.target.value })} /></label><label>Обвинение<textarea value={selected.crime} required maxLength={300} rows={3} onChange={event => setSelected({ ...selected,crime:event.target.value })} /></label><label>Улика или контекст<textarea value={selected.context || ''} maxLength={1000} rows={3} onChange={event => setSelected({ ...selected,context:event.target.value })} /></label>{selected.id && <><label>Материалы дела<textarea value={selected.details || ''} maxLength={5000} rows={4} onChange={event => setSelected({ ...selected,details:event.target.value })} /></label><label>Подсказка для защиты<textarea value={selected.defense_example || ''} maxLength={1000} rows={3} onChange={event => setSelected({ ...selected,defense_example:event.target.value })} /></label></>}<div className="inspector-actions"><button className="primary-action" disabled={pending}>Сохранить дело</button><button type="button" className="secondary-action" onClick={() => { setSelected(cards.find(card => card.id === selected.id) || null); setEditing(false) }}>Отмена</button></div></form> : <div className="settings-panel"><div className="inspector-meta"><span>{selected.source === 'ai' ? 'Сгенерировано' : 'Из колоды'}</span><span>{selected.used ? 'Сыграно' : 'Готово к заседанию'}</span></div><h2>{selected.title}</h2><h3>Обвинение</h3><p>{selected.crime}</p>{selected.context && <><h3>Улика или контекст</h3><p>{selected.context}</p></>}{selected.details && <><h3>Материалы</h3><p className="case-long-text">{selected.details}</p></>}{selected.defense_example && <><h3>Зацепка для ведущего</h3><p className="case-long-text">{selected.defense_example}</p></>}<div className="inspector-actions"><button className="primary-action" onClick={() => navigate('/', { state: { preparedCase: selected } })}>Подготовить в пульте<ArrowRight size={14} /></button><button className="secondary-action" onClick={() => setEditing(true)}>Изменить</button><button aria-label="Удалить выбранное дело" className="file-text-button" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /></button></div>{confirmDelete && <div className="delete-case-confirm"><span>Удалить «{selected.title}» из колоды?</span><button disabled={pending} className="stop-button" onClick={async () => {
      setPending(true)
      try { const response = await apiFetch(`/api/cases?id=${encodeURIComponent(selected.id)}`, { method: 'DELETE' }); if (response.ok) { setSelected(null); setConfirmDelete(false); await refresh() } else setError('Не удалось удалить дело.') } catch { setError('Нет связи с сервером.') }
      setPending(false)
    }}>Удалить</button><button className="file-text-button" onClick={() => setConfirmDelete(false)}>Отмена</button></div>}</div> : <div className="inspector-placeholder"><h2>Выберите дело слева</h2><p>Здесь будут обвинение, улики и подсказка для ведущего. Кнопка подготовки перенесёт дело в пульт без запуска суда.</p></div>}</section></div>
  </div>
}
