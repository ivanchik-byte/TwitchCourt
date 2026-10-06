import { useEffect, useRef } from 'react'

export interface HotkeyMap {
  onGavel?: () => void
  onPardon?: () => void
  onMute60?: () => void
  onMute300?: () => void
  onBan?: () => void
  onRandom?: () => void
  onSkip?: () => void
  onPanic?: () => void
}

function inField(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  return !!t?.closest?.('input, textarea, select, [contenteditable]')
}

export function useHotkeys(map: HotkeyMap, panicCode = 'Escape') {
  const ref = useRef(map)
  ref.current = map
  const panicRef = useRef(panicCode)
  panicRef.current = panicCode

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (inField(e)) return
      // never hijack browser/OS shortcuts: Ctrl+R must reload, not open a trial
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const el = e.target as HTMLElement | null
      const m = ref.current
      if (e.code === panicRef.current) {
        e.preventDefault()
        m.onPanic?.()
        return
      }
      switch (e.code) {
        case 'Space':
          // a focused button already fires on Space — don't double-fire the gavel
          if (el?.closest?.('button, [role="button"], a')) return
          e.preventDefault()
          m.onGavel?.()
          break
        case 'Digit1':
          m.onPardon?.()
          break
        case 'Digit2':
          m.onMute60?.()
          break
        case 'Digit3':
          m.onMute300?.()
          break
        case 'Digit4':
          m.onBan?.()
          break
        case 'KeyR':
          m.onRandom?.()
          break
        case 'KeyN':
          m.onSkip?.()
          break
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
}
