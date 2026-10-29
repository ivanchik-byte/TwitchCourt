import { useEffect, useId, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CircleHelp } from 'lucide-react'

export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId()
  const [anchor, setAnchor] = useState<{ left: number; top: number; below: boolean } | null>(null)
  useEffect(() => {
    if (!anchor) return
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setAnchor(null) } }
    const hide = () => setAnchor(null)
    document.addEventListener('keydown', dismiss, true)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => { document.removeEventListener('keydown', dismiss, true); window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide) }
  }, [anchor])
  const show = (target: HTMLElement) => {
    const box = target.getBoundingClientRect()
    const halfWidth = Math.min(360, innerWidth - 32) / 2
    setAnchor({ left: Math.max(halfWidth + 16, Math.min(innerWidth - halfWidth - 16, box.left + box.width / 2)), top: box.top < 220 ? box.bottom + 8 : box.top - 8, below: box.top < 220 })
  }
  return <span className="help-trigger" role="button" tabIndex={0} aria-label={`Подсказка: ${label}`} aria-describedby={anchor ? id : undefined}
    onMouseEnter={event => show(event.currentTarget)} onMouseLeave={event => { if (document.activeElement !== event.currentTarget) setAnchor(null) }}
    onFocus={event => show(event.currentTarget)} onBlur={() => setAnchor(null)}
    onClick={event => { event.preventDefault(); event.stopPropagation(); anchor ? setAnchor(null) : show(event.currentTarget) }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); setAnchor(null) }
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); anchor ? setAnchor(null) : show(event.currentTarget) }
    }}>
    <CircleHelp size={14} aria-hidden="true" />
    {anchor && createPortal(<span id={id} role="tooltip" className={`help-bubble${anchor.below ? ' is-below' : ''}`} style={{ left: anchor.left, top: anchor.top }}>{children}</span>, document.body)}
  </span>
}
