import { Shuffle, SkipForward } from 'lucide-react'
import { useTribunal } from '../../tribunal/TribunalContext'

export function BenchQueue() {
  const { t, pool, pick, skip } = useTribunal()

  return (
    <section className="card flex min-h-0 flex-col gap-2 p-3">
      <p className="text-[11px] uppercase tracking-widest text-zinc-500">Скамья · !court</p>
      <div className="shrink-0 rounded-lg border border-white/10 bg-black/30 p-2.5">
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
      <ul className="flex min-h-[120px] flex-col gap-1 overflow-y-auto lg:flex-1">
        {pool.length === 0 && !t.defendant && (
          <li className="rounded-lg border border-dashed border-white/10 p-2 text-sm text-zinc-500">
            Очередь пуста. Ждём !court.
          </li>
        )}
        {pool.map((s) => (
          <li key={s.nick} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
            <span className="min-w-0 flex-1 truncate text-sm">{s.nick}</span>
            <button
              onClick={() => void pick(s.nick)}
              className="pressable rounded-md border border-white/10 px-2 py-0.5 text-xs text-zinc-300"
            >
              Взять
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-auto flex shrink-0 gap-1.5">
        <button
          onClick={() => void pick()}
          className="pressable flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-sm"
        >
          <Shuffle size={14} /> Случайный <span className="keycap">R</span>
        </button>
        <button
          onClick={() => void skip()}
          className="pressable flex items-center gap-1.5 rounded-lg border border-white/10 px-2 py-2 text-sm text-zinc-300"
        >
          <SkipForward size={14} /> <span className="keycap">Tab</span>
        </button>
      </div>
    </section>
  )
}
