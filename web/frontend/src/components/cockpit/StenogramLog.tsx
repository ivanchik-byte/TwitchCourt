import { useEffect, useRef } from 'react'
import { cn } from '../../lib/cn'
import { useTribunalState } from '../../tribunal/TribunalContext'
import type { TribunalEventType } from '../../lib/types'

function colorFor(kind: TribunalEventType | 'local') {
  switch (kind) {
    case 'verdict':
      return 'text-red-300'
    case 'subtitles':
      return 'text-amber-200'
    case 'testimony':
      return 'text-zinc-200'
    case 'donation':
      return 'text-emerald-200'
    default:
      return 'text-zinc-400'
  }
}

export function StenogramLog() {
  const t = useTribunalState()
  const listRef = useRef<HTMLUListElement | null>(null)

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    // don't yank the scroll while the streamer reads history
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
      el.scrollTop = el.scrollHeight
    }
  }, [t.stenogram.length])

  return (
    <section className="card flex min-h-[160px] flex-col gap-1.5 p-3 lg:min-h-0 lg:flex-1" aria-label="Стенограмма">
      <p className="shrink-0 text-[11px] uppercase tracking-widest text-zinc-500">Стенограмма</p>
      <ul ref={listRef} role="log" aria-live="off" className="max-h-56 space-y-1 overflow-y-auto lg:max-h-none lg:flex-1">
        {t.stenogram.length === 0 && <li className="text-sm text-zinc-600">Заседание не идёт.</li>}
        {t.stenogram.slice(-40).map((e) => (
          <li key={e.id} className={cn('text-sm', colorFor(e.kind))}>
            {e.speaker && <span className="mr-1 font-mono text-xs text-zinc-500">{e.speaker}:</span>}
            {e.text}
          </li>
        ))}
      </ul>
    </section>
  )
}
