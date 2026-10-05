import { useState } from 'react'
import { Gavel } from 'lucide-react'
import { cn } from '../../lib/cn'
import { useTribunal } from '../../tribunal/TribunalContext'

const ARTICLES = ['Слив катки', 'Токсичность в чате', 'Опоздание', 'Байт на бан', 'Духота в голосовом']

function Timer({ secs }: { secs: number | null }) {
  if (secs == null) return <span className="timer-digits tabular text-zinc-500">--:--</span>
  const m = Math.floor(secs / 60)
  const s = secs % 60
  const urgent = secs <= 5
  const warn = secs <= 15
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
  const { t, gavel, openTrial } = useTribunal()
  const [nick, setNick] = useState('')
  const [crime, setCrime] = useState('')

  return (
    <section className="card flex shrink-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-zinc-500">Ход суда</p>
          <p className="text-lg font-semibold">{t.phase === 'idle' ? 'Зал пуст' : t.phase}</p>
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
        <input
          value={nick}
          onChange={(e) => setNick(e.target.value)}
          placeholder="Ник зрителя"
          autoComplete="off"
          className="h-9 rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm outline-none focus:border-amber-400/50"
        />
        <input
          value={crime}
          onChange={(e) => setCrime(e.target.value)}
          placeholder="За что судим"
          autoComplete="off"
          className="h-9 rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm outline-none focus:border-amber-400/50"
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ARTICLES.map((a) => (
          <button
            key={a}
            onClick={() => void openTrial(nick, a)}
            className="pressable rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300 hover:border-amber-400/40"
          >
            {a}
          </button>
        ))}
      </div>
      <button
        onClick={() => void openTrial(nick, crime)}
        className="pressable w-full rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold"
      >
        Открыть дело
      </button>
    </section>
  )
}
