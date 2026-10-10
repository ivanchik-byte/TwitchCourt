import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { apiGet, apiPostJson, apiFetch, apiNote } from '../lib/api'

interface CaseCard {
  id: string
  title: string
  crime: string
  context?: string
  details?: string
  defense_example?: string
  tags?: string[]
  source?: string
  used?: boolean
}

export function CasesView() {
  const [cases, setCases] = useState<CaseCard[]>([])
  const [remaining, setRemaining] = useState(0)
  const [target, setTarget] = useState<'viewer' | 'streamer'>('viewer')
  const [title, setTitle] = useState('')
  const [crime, setCrime] = useState('')
  const [context, setContext] = useState('')

  const refresh = useCallback(async () => {
    try {
      const d = await apiGet<{ cases: CaseCard[]; remaining: number }>('/api/cases')
      setCases(d.cases ?? [])
      setRemaining(d.remaining ?? 0)
    } catch {
      toast.error('Дела недоступны: проверьте секретный ключ')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const draw = async () => {
    const r = await apiPostJson<{ case: CaseCard; defendant: string; remaining: number }>('/api/cases/draw', {
      target,
      start: true,
    })
    if (!r.ok || !r.data) {
      toast.error(`Дело не вытянуто: ${apiNote(r.status)}`)
      return
    }
    toast.success(`На скамье ${r.data.defendant}: ${r.data.case.title}`)
    void refresh()
  }

  const add = async () => {
    if (!title.trim()) {
      toast.error('Укажите название дела')
      return
    }
    const r = await apiPostJson('/api/cases', { title: title.trim(), crime, context })
    if (!r.ok) {
      toast.error(`Не добавлено: ${apiNote(r.status)}`)
      return
    }
    setTitle('')
    setCrime('')
    setContext('')
    toast.success('Дело в колоде')
    void refresh()
  }

  const remove = async (id: string) => {
    const res = await apiFetch(`/api/cases?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!res.ok) toast.error(`Не удалено: ${apiNote(res.status)}`)
    void refresh()
  }

  const reset = async () => {
    const r = await apiPostJson('/api/cases/reset', {})
    if (!r.ok) toast.error(`Не сброшено: ${apiNote(r.status)}`)
    else toast.success('Колода перетасована')
    void refresh()
  }

  const generate = async () => {
    toast('Генерирую дела…')
    const r = await apiPostJson<{ added: number; remaining: number }>('/api/cases/generate', {})
    if (!r.ok || !r.data) {
      toast.error(`Не сгенерировано: ${apiNote(r.status)}`)
      return
    }
    toast.success(`Добавлено дел: ${r.data.added}`)
    void refresh()
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-3 p-3">
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-zinc-500">Осталось дел</p>
          <p className="text-2xl font-bold tabular">{remaining}</p>
        </div>
        <div className="flex rounded-lg border border-white/10 p-0.5 text-sm">
          {(['viewer', 'streamer'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setTarget(m)}
              className={`rounded-md px-3 py-1.5 ${target === m ? 'bg-white/10 text-white' : 'text-zinc-400'}`}
            >
              {m === 'viewer' ? 'Случайный зритель' : 'Стример'}
            </button>
          ))}
        </div>
        <button
          onClick={() => void draw()}
          className="pressable rounded-lg bg-amber-400/90 px-5 py-2 font-bold text-black"
        >
          Вытянуть дело
        </button>
        <button
          onClick={() => void reset()}
          className="pressable ml-auto rounded-lg border border-white/10 px-3 py-1.5 text-sm"
        >
          Перетасовать
        </button>
        <button
          onClick={() => void generate()}
          className="pressable rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-sm"
        >
          Сгенерировать
        </button>
      </div>

      <div className="card space-y-2 p-4">
        <h2 className="font-semibold">Новое дело</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-xs text-zinc-400">
            Название
            <input
              value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Слив катки" autoComplete="off"
              className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm text-white outline-none"
            />
          </label>
          <label className="block text-xs text-zinc-400">
            Контекст
            <input
              value={context} onChange={(e) => setContext(e.target.value)} placeholder="чат всё видел" autoComplete="off"
              className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm text-white outline-none"
            />
          </label>
        </div>
        <label className="block text-xs text-zinc-400">
          Обвинение
          <textarea
            value={crime} onChange={(e) => setCrime(e.target.value)} rows={2}
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-sm text-white outline-none"
          />
        </label>
        <button
          onClick={() => void add()}
          className="pressable rounded-lg border border-white/10 px-4 py-1.5 text-sm"
        >
          В колоду
        </button>
      </div>

      <div className="card space-y-1 p-4">
        <h2 className="font-semibold">Колода · {cases.length}</h2>
        {cases.length === 0 && <p className="text-sm text-zinc-500">Пусто. Добавь дела выше или сгенерируй кнопкой ниже.</p>}
        {cases.map((c) => (
          <div key={c.id} className={`flex items-start gap-2 rounded-lg border border-white/5 px-2.5 py-2 ${c.used ? 'opacity-40' : ''}`}>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {c.title}
                {c.used && <span className="ml-2 font-mono text-xs text-zinc-500">сыграно</span>}
                {c.source === 'ai' && <span className="ml-2 font-mono text-xs text-emerald-400">ai</span>}
              </p>
              {c.crime && <p className="truncate text-xs text-zinc-400">{c.crime}</p>}
              {(c.details || c.defense_example) && (
                <details className="mt-1 text-xs text-zinc-400">
                  <summary className="cursor-pointer text-zinc-500">Материалы дела</summary>
                  {c.details && <p className="mt-1 whitespace-pre-wrap">{c.details}</p>}
                  {c.defense_example && <p className="mt-1 whitespace-pre-wrap text-amber-200/80">{c.defense_example}</p>}
                </details>
              )}
            </div>
            <button
              onClick={() => void remove(c.id)}
              aria-label={`Удалить ${c.title}`}
              className="pressable rounded-md border border-red-400/30 px-2 py-0.5 text-xs text-red-300"
            >
              Удалить
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
