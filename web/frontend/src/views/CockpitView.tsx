import { useEffect, useState } from 'react'
import { Shuffle, SkipForward, Gavel, Mic } from 'lucide-react'
import { apiGet, apiPost } from '../lib/api'
import { cn } from '../lib/cn'
import { useAudioMeter } from '../hooks/useAudioMeter'
import { useDefenseMic } from '../hooks/useDefenseMic'
import { useHotkeys } from '../hooks/useHotkeys'
import type { PoolSeat, TribunalEventType } from '../lib/types'
import type { Tribunal } from '../hooks/useTribunalWS'

const ARTICLES = ['Слив катки', 'Токсичность в чате', 'Опоздание', 'Байт на бан', 'Духота в голосовом']

function Timer({ secs }: { secs: number | null }) {
  if (secs == null) return <span className="timer-digits text-zinc-500">--:--</span>
  const m = Math.floor(secs / 60)
  const s = secs % 60
  const urgent = secs <= 5
  const warn = secs <= 15
  return (
    <span
      className={cn(
        'timer-digits text-2xl font-semibold',
        urgent ? 'animate-pulse text-red-400' : warn ? 'text-amber-300' : 'text-emerald-300',
      )}
    >
      {String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
    </span>
  )
}

export function CockpitView({ t }: { t: Tribunal }) {
  const [pool, setPool] = useState<PoolSeat[]>([])
  const [nick, setNick] = useState('')
  const [crime, setCrime] = useState('')
  const [punishNote, setPunishNote] = useState('')
  const defenseLive = t.phase === 'defense' || t.phase === 'testimony'
  const { canvasRef } = useAudioMeter(defenseLive)
  const { transcript, listening } = useDefenseMic(defenseLive, (text) => {
    t.send('defense', { author: 'стример', text })
  })

  const refreshDock = async () => {
    try {
      const d = await apiGet<{ pool: PoolSeat[]; defendant: string }>('/api/dock')
      setPool(d.pool ?? [])
    } catch {
      /* offline */
    }
  }

  useEffect(() => {
    void refreshDock()
    const id = setInterval(refreshDock, 4000)
    return () => clearInterval(id)
  }, [])

  const gavel = () => {
    t.send('gavel', {})
  }
  const punish = async (kind: string, secs?: number) => {
    const ok = await apiPost('/api/punish', { kind, secs: secs ?? 0 })
    setPunishNote(ok ? `Кара выставлена: ${kind}${secs ? ` ${secs}с` : ''}` : 'Не вышло — проверь секрет')
  }
  const pick = async (name?: string) => {
    const res = await fetch('/api/dock/pick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nick: name ?? '' }),
    })
    if (res.ok) void refreshDock()
  }
  const skip = async () => {
    await fetch('/api/dock/skip', { method: 'POST' })
    t.panicReset()
    void refreshDock()
  }
  const openManual = async (defendant: string, text: string) => {
    if (!defendant.trim()) return
    await apiPost('/api/trial', { defendant: defendant.trim(), crime: text || 'выбран залом', viewer: true })
  }

  useHotkeys({
    onGavel: gavel,
    onPardon: () => void punish('pardon'),
    onMute60: () => void punish('timeout', 60),
    onMute300: () => void punish('timeout', 300),
    onBan: () => void punish('ban'),
    onRandom: () => void pick(),
    onSkip: () => void skip(),
    onPanic: () => {
      t.panicReset()
      void apiPost('/api/dock/skip', {});
    },
  })

  const colorFor = (kind: TribunalEventType | 'local' | 'state_change') => {
    switch (kind) {
      case 'verdict':
        return 'text-red-300'
      case 'subtitles':
        return 'text-amber-200'
      case 'testimony':
        return 'text-zinc-200'
      default:
        return 'text-zinc-400'
    }
  }

  return (
    <div className="mx-auto grid max-w-[1600px] gap-3 p-3 lg:grid-cols-[300px_minmax(0,1fr)_320px]">
      <section className="card flex min-h-0 flex-col gap-2 p-3">
        <p className="text-[11px] uppercase tracking-widest text-zinc-500">Скамья · !court</p>
        <div className="rounded-lg border border-white/10 bg-black/30 p-2.5">
          {t.defendant ? (
            <>
              <p className="text-sm text-zinc-400">На скамье</p>
              <p className="text-lg font-semibold text-white">{t.defendant}</p>
              {t.charge && <p className="text-sm text-zinc-400">{t.charge}</p>}
            </>
          ) : (
            <p className="text-sm text-zinc-500">Никого на скамье</p>
          )}
        </div>
        <ul className="flex min-h-[120px] flex-col gap-1 overflow-y-auto">
          {pool.length === 0 && !t.defendant && (
            <li className="rounded-lg border border-dashed border-white/10 p-2 text-sm text-zinc-500">
              Очередь пуста. Ждём !court.
            </li>
          )}
          {pool.map((s) => (
            <li key={s.nick} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
              <span className="min-w-0 flex-1 truncate text-sm">{s.nick}</span>
              <button onClick={() => void pick(s.nick)} className="pressable rounded-md border border-white/10 px-2 py-0.5 text-xs text-zinc-300">
                Взять
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-auto flex gap-1.5">
          <button onClick={() => void pick()} className="pressable flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-sm">
            <Shuffle size={14} /> Случайный <span className="keycap">R</span>
          </button>
          <button onClick={() => void skip()} className="pressable flex items-center gap-1.5 rounded-lg border border-white/10 px-2 py-2 text-sm text-zinc-300">
            <SkipForward size={14} /> <span className="keycap">Tab</span>
          </button>
        </div>
      </section>

      <section className="card flex min-h-0 flex-col gap-3 p-4">
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
          className="btn-gavel pressable flex items-center justify-center gap-2 rounded-xl border border-amber-400/40 bg-gradient-to-b from-amber-400/25 to-amber-600/20 px-4 py-4 text-lg font-bold text-amber-200"
        >
          <Gavel size={20} /> УДАРИТЬ МОЛОТКОМ <span className="keycap">Space</span>
        </button>

        <div className="rounded-lg border border-white/10 bg-black/30 p-2.5">
          <div className="mb-1.5 flex items-center gap-2 text-xs text-zinc-400">
            <Mic size={13} className={listening ? 'text-emerald-300' : ''} />
            {listening ? 'Адвокат в эфире' : 'Микрофон адвоката'}
          </div>
          <canvas ref={canvasRef} width={480} height={26} className="h-[26px] w-full rounded bg-black/50" />
          <p className="mt-1 min-h-[1.25rem] truncate font-mono text-xs text-cyan-200">{transcript || '—'}</p>
          {t.judgeLine && <p className="mt-1 text-sm text-amber-100/90">{t.judgeLine}</p>}
        </div>

        <div>
          <p className="mb-1.5 text-[11px] uppercase tracking-widest text-zinc-500">Стенограмма</p>
          <ul className="max-h-56 space-y-1 overflow-y-auto">
            {t.stenogram.length === 0 && <li className="text-sm text-zinc-600">Заседание не идёт.</li>}
            {t.stenogram.slice(-40).map((e) => (
              <li key={e.id} className={cn('text-sm', colorFor(e.kind))}>
                {e.speaker && <span className="mr-1 font-mono text-xs text-zinc-500">{e.speaker}:</span>}
                {e.text}
              </li>
            ))}
          </ul>
        </div>

        <div className="grid max-w-prose gap-1.5 sm:grid-cols-2">
          <input value={nick} onChange={(e) => setNick(e.target.value)} placeholder="Ник зрителя" autoComplete="off"
            className="h-9 rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm outline-none focus:border-amber-400/50" />
          <input value={crime} onChange={(e) => setCrime(e.target.value)} placeholder="За что судим" autoComplete="off"
            className="h-9 rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm outline-none focus:border-amber-400/50" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ARTICLES.map((a) => (
            <button key={a} onClick={() => void openManual(nick, a)}
              className="pressable rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300 hover:border-amber-400/40">
              {a}
            </button>
          ))}
        </div>
        <button onClick={() => void openManual(nick, crime)} className="pressable rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold">
          Открыть дело
        </button>
      </section>

      <section className="card flex min-h-0 flex-col gap-2 p-3">
        <p className="text-[11px] uppercase tracking-widest text-zinc-500">Кара · вердикт в 1 клик</p>
        <div className="grid grid-cols-2 gap-1.5">
          <button onClick={() => void punish('pardon')} className="pressable rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2 py-2.5 text-sm">Помиловать <span className="keycap ml-1">1</span></button>
          <button onClick={() => void punish('timeout', 60)} className="pressable rounded-lg border border-white/10 bg-white/5 px-2 py-2.5 text-sm">Мут 60с <span className="keycap ml-1">2</span></button>
          <button onClick={() => void punish('timeout', 300)} className="pressable rounded-lg border border-white/10 bg-white/5 px-2 py-2.5 text-sm">Мут 300с <span className="keycap ml-1">3</span></button>
          <button onClick={() => { if (window.confirm('Точно забанить канал?')) void punish('ban') }} className="pressable rounded-lg border border-red-400/30 bg-red-400/10 px-2 py-2.5 text-sm">Бан <span className="keycap ml-1">4</span></button>
        </div>
        {punishNote && <p className="text-xs text-zinc-400">{punishNote}</p>}
        {t.verdict && (
          <div className="rounded-lg border border-white/10 bg-black/30 p-2 text-sm">
            <span className={cn('font-bold', t.verdict.verdict.includes('НЕВИН') ? 'text-emerald-300' : 'text-red-300')}>{t.verdict.verdict}</span>
            {t.verdict.penalty && <span className="text-zinc-300"> · {t.verdict.penalty}</span>}
          </div>
        )}
        <p className="text-[11px] uppercase tracking-widest text-zinc-500">Протокол</p>
        <ul className="space-y-1 overflow-y-auto">
          {t.stenogram.filter((e) => e.kind === 'verdict').length === 0 && (
            <li className="text-sm text-zinc-600">Приговоров пока нет.</li>
          )}
          {t.stenogram.filter((e) => e.kind === 'verdict').map((e) => (
            <li key={e.id} className="rounded-lg bg-white/[0.03] p-1.5 text-sm text-zinc-200">{e.text}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}
