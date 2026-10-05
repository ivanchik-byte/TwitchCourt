import { useMemo } from 'react'
import { cn } from '../../lib/cn'
import { useTribunalState } from '../../tribunal/TribunalContext'
import { useBan, usePunishWithToast } from './usePunish'

export function PunishmentMatrix() {
  const t = useTribunalState()
  const ban = useBan()
  const punishToast = usePunishWithToast()

  const verdicts = useMemo(() => t.stenogram.filter((e) => e.kind === 'verdict'), [t.stenogram])

  return (
    <section className="card flex min-h-0 flex-col gap-2 p-3" aria-label="Наказание">
      <p className="text-[11px] uppercase tracking-widest text-zinc-500">Кара · вердикт в 1 клик</p>
      <div className="grid shrink-0 grid-cols-2 gap-1.5">
        <button
          onClick={() => void punishToast('pardon')}
          aria-label="Помиловать (1)"
          className="pressable rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2 py-2.5 text-sm"
        >
          Помиловать <span className="keycap ml-1">1</span>
        </button>
        <button
          onClick={() => void punishToast('timeout', 60)}
          aria-label="Мут 60 секунд (2)"
          className="pressable rounded-lg border border-white/10 bg-white/5 px-2 py-2.5 text-sm"
        >
          Мут 60с <span className="keycap ml-1">2</span>
        </button>
        <button
          onClick={() => void punishToast('timeout', 300)}
          aria-label="Мут 300 секунд (3)"
          className="pressable rounded-lg border border-white/10 bg-white/5 px-2 py-2.5 text-sm"
        >
          Мут 300с <span className="keycap ml-1">3</span>
        </button>
        <button
          onClick={() => void ban()}
          aria-label="Бан канала (4)"
          className="pressable rounded-lg border border-red-400/30 bg-red-400/10 px-2 py-2.5 text-sm"
        >
          Бан <span className="keycap ml-1">4</span>
        </button>
      </div>
      {t.verdict && (
        <div className="shrink-0 rounded-lg border border-white/10 bg-black/30 p-2 text-sm">
          <span
            className={cn(
              'font-bold',
              t.verdict.verdict === 'НЕВИНОВЕН' ? 'text-emerald-300' : 'text-red-300',
            )}
          >
            {t.verdict.verdict}
          </span>
          {t.verdict.penalty && <span className="text-zinc-300"> · {t.verdict.penalty}</span>}
          <span className="tabular ml-2 font-mono text-xs text-zinc-500">
            {t.verdict.guilty_votes}/{t.verdict.total_votes}
            {typeof t.verdict.witnesses === 'number' && t.verdict.witnesses > 0 && ` · свид. ${t.verdict.witnesses}`}
          </span>
          {t.verdict.twist && <span className="block text-xs text-zinc-400">{t.verdict.twist}</span>}
        </div>
      )}
      <p className="text-[11px] uppercase tracking-widest text-zinc-500">Протокол</p>
      <ul className="min-h-[60px] space-y-1 overflow-y-auto lg:flex-1">
        {verdicts.length === 0 && <li className="text-sm text-zinc-600">Приговоров пока нет.</li>}
        {verdicts.map((e) => (
          <li key={e.id} className="rounded-lg bg-white/[0.03] p-1.5 text-sm text-zinc-200">{e.text}</li>
        ))}
      </ul>
    </section>
  )
}
