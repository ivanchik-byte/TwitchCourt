import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { apiGet, apiPut, apiNote } from '../lib/api'

export type ConsoleTheme = 'graphite' | 'slate' | 'walnut'
export interface Appearance {
  theme: ConsoleTheme
  judge_preset: 'original' | 'magistrate' | 'custom'
  show_judge: boolean
  reduce_motion: boolean
  has_custom_judge: boolean
  has_custom_background: boolean
  background_url: string
  photo_url: string
}

type AppearancePatch = Pick<Appearance, 'theme' | 'judge_preset' | 'show_judge' | 'reduce_motion'>
interface AppearanceControls {
  appearance: Appearance | null
  error: string
  refresh: () => Promise<void>
  save: (patch: AppearancePatch) => Promise<void>
}

const AppearanceContext = createContext<AppearanceControls | null>(null)

export function previewTheme(theme: ConsoleTheme) {
  document.documentElement.dataset.theme = theme
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance | null>(null)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    const saved = await apiGet<Appearance>('/api/appearance')
    setAppearance(saved)
    setError('')
  }, [])

  useEffect(() => {
    void refresh().catch(() => setError('Не удалось загрузить оформление. Проверьте связь с сервером.'))
    const sync = (event: Event) => setAppearance((event as CustomEvent<Appearance>).detail)
    window.addEventListener('tribunal-appearance', sync)
    return () => window.removeEventListener('tribunal-appearance', sync)
  }, [refresh])

  useEffect(() => {
    if (!appearance) return
    previewTheme(appearance.theme)
    document.documentElement.dataset.reduceMotion = String(appearance.reduce_motion)
    localStorage.setItem('tribunal-theme', appearance.theme)
  }, [appearance])

  const save = async ({ theme, judge_preset, show_judge, reduce_motion }: AppearancePatch) => {
    const response = await apiPut('/api/appearance', { theme, judge_preset, show_judge, reduce_motion })
    if (!response.ok) throw new Error(`Оформление не сохранено: ${apiNote(response.status)}.`)
    await refresh()
  }

  return <AppearanceContext.Provider value={{ appearance, error, refresh, save }}>{children}</AppearanceContext.Provider>
}

export function useAppearance() {
  const controls = useContext(AppearanceContext)
  if (!controls) throw new Error('AppearanceProvider is missing')
  return controls
}
