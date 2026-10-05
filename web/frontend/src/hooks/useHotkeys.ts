import { useEffect } from 'react'

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
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (inField(e)) return
      switch (e.code) {
        case 'Space':
          e.preventDefault()
          map.onGavel?.()
          break
        case 'Digit1':
          map.onPardon?.()
          break
        case 'Digit2':
          map.onMute60?.()
          break
        case 'Digit3':
          map.onMute300?.()
          break
        case 'Digit4':
          map.onBan?.()
          break
        case 'KeyR':
          map.onRandom?.()
          break
        case 'Tab':
          e.preventDefault()
          map.onSkip?.()
          break
        case 'F12':
          e.preventDefault()
          map.onPanic?.()
          break
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [map])
}
