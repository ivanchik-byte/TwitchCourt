import { Plus, X } from 'lucide-react'
import type { ShowCase } from '../../lib/show'

interface CaseEditorProps {
  card: ShowCase
  busy: boolean
  onChange: (card: ShowCase) => void
  onSave: () => Promise<void>
  onCancel: () => void
}

export function CaseEditor({ card, busy, onChange, onSave, onCancel }: CaseEditorProps) {
  const fields = [
    ['crime', 'Обвинение', 300, 2],
    ['context', 'Что известно в начале', 1000, 3],
    ['details', 'Материалы дела', 5000, 3],
    ['dilemma', 'О чём могут спорить стороны', 500, 2],
    ['defense_example', 'Зацепка для защиты', 1000, 2],
    ['question', 'Вопрос ведущему или чату', 500, 2],
  ] as const
  const exhibits = card.exhibits ?? []

  return <form className="settings-panel case-editor" onSubmit={event => { event.preventDefault(); void onSave() }}>
    <fieldset disabled={busy}>
      <h2>{card.id ? 'Изменить дело' : 'Новое дело'}</h2>
      <label>Название<input value={card.title} required maxLength={120} onChange={event => onChange({ ...card, title: event.target.value })} /></label>
      {fields.map(([key, label, maxLength, rows]) => <label key={key}>{label}<textarea value={card[key] || ''} required={key === 'crime'} maxLength={maxLength} rows={rows} onChange={event => onChange({ ...card, [key]: event.target.value })} /></label>)}
      <div className="settings-panel-heading"><h3>Дополнительные улики</h3><button type="button" className="file-text-button" disabled={exhibits.length >= 3} onClick={() => onChange({ ...card, exhibits: [...exhibits, { title: '', text: '' }] })}><Plus size={13} />Добавить улику</button></div>
      <p>Эти факты не попадут к судье до команды ведущего. До трёх улик на дело.</p>
      {exhibits.map((exhibit, index) => <div className="exhibit-editor" key={index}>
        <div><span>Улика {index + 1}</span><button type="button" aria-label={`Убрать улику ${index + 1}`} onClick={() => onChange({ ...card, exhibits: exhibits.filter((_, position) => position !== index) })}><X size={14} /></button></div>
        <label>Название улики {index + 1}<input required maxLength={80} value={exhibit.title} onChange={event => onChange({ ...card, exhibits: exhibits.map((entry, position) => position === index ? { ...entry, title: event.target.value } : entry) })} /></label>
        <label>Текст улики {index + 1}<textarea required rows={3} maxLength={500} value={exhibit.text} onChange={event => onChange({ ...card, exhibits: exhibits.map((entry, position) => position === index ? { ...entry, text: event.target.value } : entry) })} /></label>
      </div>)}
      <div className="inspector-actions"><button className="primary-action">{busy ? 'Сохраняем…' : 'Сохранить дело'}</button><button type="button" className="secondary-action" onClick={onCancel}>Отмена</button></div>
    </fieldset>
  </form>
}
