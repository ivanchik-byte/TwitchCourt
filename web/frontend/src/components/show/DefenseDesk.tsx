import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
import { Mic, Send } from 'lucide-react'
import { toast } from 'sonner'
import { apiPostJson, apiNote } from '../../lib/api'
import { useDefenseMic } from '../../hooks/useDefenseMic'
import { modes, type CourtMode } from '../../lib/show'

export function DefenseDesk({ enabled, demo, mode, text, onTextChange }: { enabled: boolean; demo: boolean; mode: CourtMode; text: string; onTextChange: Dispatch<SetStateAction<string>> }) {
  const [useMic, setUseMic] = useState(false)
  const [sending, setSending] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const submit = useCallback(async (line: string) => {
    const response = await apiPostJson<{ accepted: boolean }>('/api/defense', { author: 'стример', text: line })
    if (!response.ok) { toast.error(apiNote(response.status)); return false }
    if (!response.data?.accepted) { toast.error('Этап уже закончился. Ответ не приобщён.'); return false }
    setAccepted(true)
    return true
  }, [])
  const mic = useDefenseMic(enabled && useMic, (line) => { void submit(line) })

  return (
    <section className="desk-panel defense-desk" aria-label="Слово ведущего">
      <div className="panel-heading"><div><p className="eyebrow">Слово ведущего</p><h2>{modes[mode].role}</h2></div><button className={`mic-button ${mic.listening ? 'is-listening' : ''}`} disabled={!enabled || demo || !mic.supported} aria-pressed={useMic} onClick={() => setUseMic(!useMic)}><Mic size={15} />{useMic ? 'Выключить микрофон' : 'Включить микрофон'}</button></div>
      <p>{demo ? 'В репетиции ответы уже написаны. В настоящем деле судья получит вашу речь или текст.' : enabled ? 'Отправьте аргумент, затем передайте слово судье.' : 'Поле откроется, когда наступит ваше слово.'}</p>
      {accepted && <p className="defense-accepted" role="status">Аргумент приобщён. Можно добавить ещё или передать слово судье.</p>}
      {mic.error && <p role="alert">{mic.error}</p>}
      {mic.transcript && <p className="recognized-speech">{mic.transcript}</p>}
      {!mic.supported && !demo && <p>В этом браузере используйте текстовый ответ.</p>}
      <form onSubmit={async (event) => {
        event.preventDefault()
        if (!text.trim() || !enabled || sending) return
        setSending(true)
        if (await submit(text.trim())) onTextChange(current => current === text ? '' : current)
        setSending(false)
      }}><label className="sr-only" htmlFor="defense-text">Ваш аргумент</label><textarea id="defense-text" value={text} disabled={!enabled || sending} onChange={(event) => { onTextChange(event.target.value); setAccepted(false) }} maxLength={600} rows={2} placeholder="Ваша честь, у защиты есть объяснение…" /><button className="secondary-action" disabled={!enabled || !text.trim() || sending}><Send size={15} /> {sending ? 'Отправляем…' : 'Отправить аргумент'}</button></form>
    </section>
  )
}
