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

export function useHotkeys(map: HotkeyMap) {
  const ref = useRef(map)
  ref.current = map

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (inField(e)) return
      const m = ref.current
      switch (e.code) {
        case 'Space':
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
        case 'Tab':
          e.preventDefault()
          m.onSkip?.()
          break
        case 'F12':
          e.preventDefault()
          m.onPanic?.()
          break
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
}
