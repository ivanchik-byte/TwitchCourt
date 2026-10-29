import { useEffect, useRef } from 'react'
import { useTribunalFeed } from '../../tribunal/TribunalContext'

export function StenogramLog() {
  const t = useTribunalFeed()
  const listRef = useRef<HTMLUListElement | null>(null)

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    // preserve scroll position while reading log history
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
      el.scrollTop = el.scrollHeight
    }
  }, [t.stenogram.length])

  return (
    <section className="stenogram" aria-label="Стенограмма">
      <ul ref={listRef} role="log" aria-live="off" className="protocol-log">
        {t.stenogram.length === 0 && <li className="protocol-empty">Реплики появятся после открытия дела.</li>}
        {t.stenogram.slice(-40).map((e) => (
          <li key={e.id} className="protocol-entry" data-kind={e.kind}>
            {e.speaker && <span className="protocol-speaker">{e.speaker}</span>}
            {e.text}
          </li>
        ))}
      </ul>
    </section>
  )
}
