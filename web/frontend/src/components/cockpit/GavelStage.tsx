import { useEffect, useState } from 'react'
import { Gavel } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '../../lib/cn'
import { apiGet, apiNote } from '../../lib/api'
import { useTribunalActions, useTribunalPhase } from '../../tribunal/TribunalContext'

function Timer({ secs }: { secs: number | null }) {
  const [left, setLeft] = useState(secs)
  useEffect(() => {
    setLeft(secs)
    if (secs == null) return
    const id = setInterval(() => setLeft((s) => (s != null && s > 0 ? s - 1 : s)), 1000)
    return () => clearInterval(id)
  }, [secs])
  if (left == null) return <span className="timer-digits tabular text-zinc-500">--:--</span>
  const m = Math.floor(left / 60)
  const s = left % 60
  const urgent = left <= 5
  const warn = left <= 15
  return (
    <span
      className={cn(
        'timer-digits tabular text-2xl font-semibold',
        urgent ? 'animate-pulse text-red-400' : warn ? 'text-amber-300' : 'text-emerald-300',
      )}
    >
      {String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
    </span>
  )
}

export function GavelStage() {
  const t = useTribunalPhase()
  const { gavel, openTrial } = useTribunalActions()
  const [nick, setNick] = useState('')
  const [crime, setCrime] = useState('')
  const [articles, setArticles] = useState<string[]>([])

  useEffect(() => {
    void apiGet<{ articles?: string[] }>('/api/settings')
      .then((d) => {
        if (Array.isArray(d.articles)) setArticles(d.articles)
      })
      .catch(() => undefined)
  }, [])

  const open = async (text: string) => {
    const r = await openTrial(nick, text)
    if (!r.ok) toast.error(`Не удалось начать заседание: ${apiNote(r.status)}`)
  }

  return (
    <section className="card flex shrink-0 flex-col gap-3 p-4" aria-label="Ход заседания">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-zinc-500">Текущий этап</p>
          <p className="text-lg font-semibold">
            {t.phase === 'idle' ? 'Заседание не начато' : t.phase}
            {t.caseTitle && <span className="ml-2 font-mono text-xs text-zinc-500">{t.caseTitle}</span>}
          </p>
        </div>
        <div className="ml-auto">
          <Timer secs={t.timeLeft} />
        </div>
      </div>

      <button
        onClick={gavel}
        className="btn-gavel pressable flex w-full items-center justify-center gap-2 rounded-xl border border-amber-400/40 bg-gradient-to-b from-amber-400/25 to-amber-600/20 px-4 py-4 text-lg font-bold text-amber-200"
      >
        <Gavel size={20} /> УДАРИТЬ МОЛОТКОМ <span className="keycap">Space</span>
      </button>

      <div className="grid gap-1.5 sm:grid-cols-2">
        <label className="block text-xs text-zinc-400">
          Никнейм участника
          <input
            value={nick} onChange={(e) => setNick(e.target.value)} placeholder="никнейм" autoComplete="off"
            className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm text-white outline-none focus:border-amber-400/50"
          />
        </label>
        <label className="block text-xs text-zinc-400">
          Пункт обвинения
          <input
            value={crime} onChange={(e) => setCrime(e.target.value)} placeholder="причина вызова" autoComplete="off"
            className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm text-white outline-none focus:border-amber-400/50"
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {articles.map((a) => (
          <button key={a} onClick={() => void open(a)} disabled={t.phase !== 'idle'}
            className="pressable rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300 hover:border-amber-400/40 disabled:opacity-40">
            {a}
          </button>
        ))}
      </div>
      <button onClick={() => void open(crime)} disabled={t.phase !== 'idle'} className="pressable w-full rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold disabled:opacity-40">
        Открыть заседание
      </button>
    </section>
  )
}
