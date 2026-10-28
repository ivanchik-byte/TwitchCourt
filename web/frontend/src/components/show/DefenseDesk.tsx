import { useCallback, useState } from 'react'
import { Mic, Send } from 'lucide-react'
import { toast } from 'sonner'
import { apiPostJson, apiNote } from '../../lib/api'
import { useDefenseMic } from '../../hooks/useDefenseMic'
import { modes, type CourtMode } from '../../lib/show'

export function DefenseDesk({ enabled, demo, mode }: { enabled: boolean; demo: boolean; mode: CourtMode }) {
  const [text, setText] = useState('')
  const [useMic, setUseMic] = useState(false)
  const [sending, setSending] = useState(false)
  const submit = useCallback(async (line: string) => {
    const response = await apiPostJson<{ accepted: boolean }>('/api/defense', { author: 'стример', text: line })
    if (!response.ok) { toast.error(apiNote(response.status)); return false }
    if (!response.data?.accepted) { toast.error('Этап уже закончился. Ответ не приобщён.'); return false }
    return true
  }, [])
  const mic = useDefenseMic(enabled && useMic, (line) => { void submit(line) })

  return (
    <section className="desk-panel defense-desk" aria-label="Слово ведущего">
      <div className="panel-heading"><div><p className="eyebrow">Слово ведущего</p><h2>{modes[mode].role}</h2></div><button className={`mic-button ${mic.listening ? 'is-listening' : ''}`} disabled={!enabled || !mic.supported} aria-pressed={useMic} onClick={() => setUseMic(!useMic)}><Mic size={15} />{useMic ? 'Выключить микрофон' : 'Включить микрофон'}</button></div>
      <p>{demo ? 'В репетиции ответы уже написаны. В настоящем деле судья получит вашу речь или текст.' : enabled ? 'Скажите аргумент или напишите его здесь. Затем передайте слово судье.' : 'Поле откроется, когда наступит ваше слово.'}</p>
      {mic.error && <p role="alert">{mic.error}</p>}
      {mic.transcript && <p className="recognized-speech">{mic.transcript}</p>}
      {!mic.supported && !demo && <p>В этом браузере используйте текстовый ответ.</p>}
      <form onSubmit={async (event) => {
        event.preventDefault()
        if (!text.trim() || !enabled || sending) return
        setSending(true)
        if (await submit(text.trim())) setText('')
        setSending(false)
      }}><label className="sr-only" htmlFor="defense-text">Ваш аргумент</label><textarea id="defense-text" value={text} disabled={!enabled || sending} onChange={(event) => setText(event.target.value)} maxLength={600} rows={2} placeholder="Ваша честь, у защиты есть объяснение…" /><button className="secondary-action" disabled={!enabled || !text.trim() || sending}><Send size={15} /> Приобщить к делу</button></form>
    </section>
  )
}
