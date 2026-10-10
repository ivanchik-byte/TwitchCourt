import { memo } from 'react'
import { toast } from 'sonner'
import { apiPut, apiNote } from '../../lib/api'
import { labelCls, saveSection, SaveButton } from './shared'

export interface PromptsState {
  judgeStrict: string
  judgeCynical: string
  prosody: string
  taskIndictment: string
  taskCounter: string
  taskDeliberation: string
  bribeNote: string
  condemnNote: string
  genPrompt: string
}

export const emptyPrompts: PromptsState = {
  judgeStrict: '',
  judgeCynical: '',
  prosody: '',
  taskIndictment: '',
  taskCounter: '',
  taskDeliberation: '',
  bribeNote: '',
  condemnNote: '',
  genPrompt: '',
}

interface Props {
  prompts: PromptsState
  setPrompts: (v: PromptsState) => void
  onReset: () => void
}

function Area({ label, value, onChange, rows = 5 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <label className={labelCls}>
      {label}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 font-mono text-xs text-white outline-none"
      />
    </label>
  )
}

export const PromptsSection = memo(function PromptsSection({ prompts, setPrompts, onReset }: Props) {
  const set = (k: keyof PromptsState) => (v: string) => setPrompts({ ...prompts, [k]: v })
  const save = () =>
    saveSection('Промпты', () =>
      apiPut('/api/prompts', {
        judge_strict: prompts.judgeStrict,
        judge_cynical: prompts.judgeCynical,
        prosody: prompts.prosody,
        task_indictment: prompts.taskIndictment,
        task_counter: prompts.taskCounter,
        task_deliberation: prompts.taskDeliberation,
        bribe_note: prompts.bribeNote,
        condemn_note: prompts.condemnNote,
        gen_prompt: prompts.genPrompt,
      })
    )
  const reset = async () => {
    if (!window.confirm('Сбросить промпты к встроенным? Свои тексты пропадут.')) return
    try {
      const r = await apiPut('/api/prompts', { reset: true })
      if (r.ok) {
        toast.success('Промпты сброшены')
        onReset()
      } else toast.error(apiNote(r.status))
    } catch {
      toast.error('Ошибка сети')
    }
  }
  return (
    <section className="card space-y-2 p-4">
      <h2 className="font-semibold">Промпты судьи</h2>
      <p className="text-xs text-zinc-500">
        Характер и задачи. Формат ответа (слово вердикта, лимиты, теги) зашит в движок и не ломается правками.
      </p>
      <Area label="Строгий судья" value={prompts.judgeStrict} onChange={set('judgeStrict')} rows={6} />
      <Area label="Циничный судья" value={prompts.judgeCynical} onChange={set('judgeCynical')} rows={6} />
      <Area label="Аудио-режиссура" value={prompts.prosody} onChange={set('prosody')} />
      <Area label="Задача: обвинение" value={prompts.taskIndictment} onChange={set('taskIndictment')} />
      <Area label="Задача: протест" value={prompts.taskCounter} onChange={set('taskCounter')} rows={3} />
      <Area label="Задача: совещание" value={prompts.taskDeliberation} onChange={set('taskDeliberation')} />
      <Area label="Приписка о взятке" value={prompts.bribeNote} onChange={set('bribeNote')} rows={2} />
      <Area label="Осуждение запретки" value={prompts.condemnNote} onChange={set('condemnNote')} rows={3} />
      <Area label="Промпт генератора дел" value={prompts.genPrompt} onChange={set('genPrompt')} rows={6} />
      <div className="flex gap-1.5">
        <SaveButton onSave={save} />
        <button
          onClick={() => void reset()}
          className="pressable rounded-lg border border-white/10 px-3 py-1.5 text-sm"
        >
          Сбросить
        </button>
      </div>
    </section>
  )
})
