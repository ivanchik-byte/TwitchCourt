import { useEffect, useState } from 'react'
import { apiGet, apiPut } from './api'

export interface ShowRules {
  witness_enabled: boolean
  rule_currency: string
  min_amounts: Record<string, number>
  default_min: number
  bribe_min: number
  bribe_words: string[]
  queue_min: number
  queue_open: boolean
  streamer_trial_min: number
  platinum_min: number
  judge_name: string
  judge_style: string
  defense_sec: number
  testimony_sec: number
  sue_threshold: number
  sue_window_sec: number
  crime_enabled: boolean
  streamer_chance: number
  punishments: string[]
  articles: string[]
  cases_gen_enabled: boolean
  cases_gen_batch: number
  cases_gen_low_mark: number
}

export function useShowRules() {
  const [rules, setRules] = useState<ShowRules | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    let active = true
    void apiGet<ShowRules>('/api/settings').then(settings => {
      if (active) setRules({ ...settings, bribe_words: settings.bribe_words ?? [], min_amounts: settings.min_amounts ?? {}, punishments: settings.punishments ?? [], articles: settings.articles ?? [] })
    }).catch(() => { if (active) setError('Не удалось загрузить правила. Проверьте сервер и ключ доступа.') })
    return () => { active = false }
  }, [])

  const save = async (patch: Partial<ShowRules>) => {
    setSaving(true)
    setSaved(false)
    setError('')
    const response = await apiPut('/api/settings', patch)
    if (!response.ok) setError(response.status === 401 ? 'Проверьте ключ доступа.' : 'Настройки не сохранены. Проверьте числа и связь с сервером.')
    else setSaved(true)
    setSaving(false)
  }
  return { rules, setRules, error, saving, saved, save }
}

export const donationActions: Record<string, string> = {
  bribe: 'Попытка подкупа', witness: 'Показание', queue: 'В приоритетную очередь',
  trial: 'Суд над стримером', support: 'Поддержка эфира', below_minimum: 'Ниже порога',
  too_late: 'Приём показаний завершён', not_started: 'Дело не открыто', rehearsal: 'Репетиция',
  queue_closed: 'Очередь закрыта', queue_full: 'Нет места в очереди', invalid_nick: 'Нужен Twitch-ник',
}
