import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { apiGet, apiPost, apiPut, apiNote } from '../lib/api'
import type { UnbanRequest } from '../lib/types'

export function ModesView() {
  const [mode, setMode] = useState<'viewer' | 'streamer' | 'unban'>('viewer')
  const [unbans, setUnbans] = useState<UnbanRequest[]>([])
  const [filter, setFilter] = useState('')
  const [defendant, setDefendant] = useState('')
  const [crime, setCrime] = useState('')
  const [context, setContext] = useState('')
  const [donor, setDonor] = useState('')
  const [amount, setAmount] = useState('500')
  const [currency, setCurrency] = useState('RUB')
  const [message, setMessage] = useState('')
  const [defenseSec, setDefenseSec] = useState(20)
  const [testimonySec, setTestimonySec] = useState(25)
  const [streamerMin, setStreamerMin] = useState('0')
  const [sueThreshold, setSueThreshold] = useState('5')
  const [sueWindow, setSueWindow] = useState('600')
  const [judgeStyle, setJudgeStyle] = useState('strict')
  const [judgeName, setJudgeName] = useState('Судья')
  const [theme, setTheme] = useState('ace_attorney')
  const [platinumMin, setPlatinumMin] = useState('500')
  const [articles, setArticles] = useState('')
  const [presets, setPresets] = useState<number[]>([])

  const loadUnbans = async () => {
    try {
      const d = await apiGet<{ requests: UnbanRequest[] }>('/api/unban')
      setUnbans(d.requests ?? [])
    } catch {
      toast.error('Unban-суд недоступен: проверьте секретный ключ')
    }
  }

  useEffect(() => {
    if (mode === 'unban') void loadUnbans()
  }, [mode])

  useEffect(() => {
    void apiGet<{
      defense_sec: number; testimony_sec: number; streamer_trial_min: number
      sue_threshold: number; sue_window_sec: number; judge_style: string; articles?: string[]
      platinum_min: number; judge_name: string; theme: string
    }>('/api/settings')
      .then((d) => {
        if (typeof d.defense_sec === 'number') setDefenseSec(d.defense_sec)
        if (typeof d.testimony_sec === 'number') setTestimonySec(d.testimony_sec)
        if (typeof d.streamer_trial_min === 'number') setStreamerMin(String(d.streamer_trial_min))
        if (typeof d.sue_threshold === 'number') setSueThreshold(String(d.sue_threshold))
        if (typeof d.sue_window_sec === 'number') setSueWindow(String(d.sue_window_sec))
        if (typeof d.judge_style === 'string') setJudgeStyle(d.judge_style)
        if (typeof d.platinum_min === 'number') setPlatinumMin(String(d.platinum_min))
        if (typeof d.judge_name === 'string') setJudgeName(d.judge_name)
        if (typeof d.theme === 'string') setTheme(d.theme)
        if (Array.isArray(d.articles)) setArticles(d.articles.join('\n'))
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    void apiGet<{ default_min: number; streamer_trial_min: number; min_amounts?: Record<string, number> }>('/api/settings')
      .then((d) => {
        const chips = new Set<number>()
        for (const v of [d.default_min, d.streamer_trial_min]) {
          if (typeof v === 'number' && v > 0) chips.add(v)
        }
        setPresets([...chips].sort((a, b) => a - b))
      })
      .catch(() => undefined)
  }, [])

  const openTrial = async () => {
    if (!defendant.trim()) {
      toast.error('Укажите никнейм подсудимого')
      return
    }
    const r = await apiPost('/api/trial', {
      defendant: defendant.trim(),
      crime: crime.trim() || (mode === 'streamer' ? 'суд над стримером' : 'решение зала'),
      context: context.trim() || undefined,
      viewer: mode !== 'streamer',
    })
    if (r.ok) toast.success('Заседание открыто')
    else toast.error(`Не удалось открыть заседание: ${apiNote(r.status)}`)
  }

  const resolve = async (id: string, approve: boolean) => {
    const r = await apiPost('/api/unban/resolve', { id, approve, text: '' })
    if (r.ok) toast.success(approve ? 'Заявка одобрена в Twitch' : 'Заявка отклонена в Twitch')
    else toast.error(`Операция не выполнена: ${apiNote(r.status)}`)
    void loadUnbans()
  }

  const openUnbanTrial = async (u: UnbanRequest) => {
    const r = await apiPost('/api/unban/trial', { id: u.id })
    if (r.ok) toast.success(`Unban-суд открыт: ${u.user}. Микрофон обвинения активен.`)
    else toast.error(`Операция не выполнена: ${apiNote(r.status)}`)
  }

  const donate = async (sum: number) => {
    if (!(sum > 0)) {
      toast.error('Укажите сумму больше нуля')
      return
    }
    const r = await apiPost('/api/donate', {
      donor: donor || 'anon',
      amount: sum,
      currency,
      message,
    })
    if (r.ok) toast.success(`Донат ${sum} ${currency} зарегистрирован`)
    else toast.error(`Донат не принят: ${apiNote(r.status)}`)
  }

  const saveParams = async () => {
    const listed = articles.split('\n').map((s) => s.trim()).filter(Boolean)
    try {
      const r = await apiPut('/api/settings', {
        defense_sec: defenseSec,
        testimony_sec: testimonySec,
        streamer_trial_min: Number(streamerMin) || 0,
        sue_threshold: Number(sueThreshold) || 0,
        sue_window_sec: Number(sueWindow) || 600,
        judge_style: judgeStyle,
        platinum_min: Number(platinumMin) || 0,
        judge_name: judgeName.trim() || undefined,
        theme: theme.trim() || undefined,
        articles: listed,
      })
      if (r.ok) toast.success('Параметры суда сохранены')
      else toast.error(`Ошибка сохранения: ${apiNote(r.status)}`)
    } catch {
      toast.error('Ошибка сети')
    }
  }

  const visible = filter.trim()
    ? unbans.filter((u) => u.user.toLowerCase().includes(filter.trim().toLowerCase()))
    : unbans

  return (
    <div className="mx-auto max-w-[1100px] space-y-3 p-3">
      <div className="card flex gap-1 p-1.5">
        {(
          [
            ['viewer', 'Суд над зрителем'],
            ['streamer', 'Суд над стримером'],
            ['unban', 'Unban-суд'],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setMode(v)}
            className={`pressable flex-1 rounded-lg px-3 py-2 text-sm font-medium ${mode === v ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode !== 'unban' && (
        <div className="card space-y-2.5 p-4">
          <p className="text-sm text-zinc-400">
            {mode === 'streamer'
              ? 'При равном счете побеждает стример. Донаты влияют на решение судьи.'
              : 'Стандартный режим: выбор зрителя из очереди !court или ручной ввод.'}
          </p>
          <div className="grid max-w-prose gap-1.5 sm:grid-cols-2">
            <label className="block text-xs text-zinc-400">
              {mode === 'streamer' ? 'Имя стримера' : 'Никнейм зрителя'}
              <input
                value={defendant} onChange={(e) => setDefendant(e.target.value)}
                autoComplete="off"
                className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm text-white outline-none focus:border-amber-400/50"
              />
            </label>
            <label className="block text-xs text-zinc-400">
              Пункт обвинения
              <input
                value={crime} onChange={(e) => setCrime(e.target.value)}
                autoComplete="off"
                className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm text-white outline-none focus:border-amber-400/50"
              />
            </label>
          </div>
          <label className="block max-w-prose text-xs text-zinc-400">
            Контекст дела
            <textarea
              value={context} onChange={(e) => setContext(e.target.value)}
              placeholder="Обстоятельства, свидетели, отягчающие факторы"
              rows={2}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-sm text-white outline-none focus:border-amber-400/50"
            />
          </label>
          <button
            onClick={() => void openTrial()}
            className="pressable rounded-lg bg-amber-400/90 px-4 py-2 text-sm font-bold text-black"
          >
            Открыть заседание
          </button>

          <div className="space-y-1.5 border-t border-white/5 pt-2.5">
            <p className="text-[11px] uppercase tracking-widest text-zinc-500">Тестовый донат судье</p>
            {presets.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {presets.map((p) => (
                  <button
                    key={p} onClick={() => void donate(p)}
                    className="pressable rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs"
                  >
                    {p} ₽
                  </button>
                ))}
              </div>
            )}
            <div className="grid max-w-prose gap-1.5 sm:grid-cols-[1fr_110px_96px_auto]">
              <label className="block text-xs text-zinc-400">
                Отправитель
                <input
                  value={donor} onChange={(e) => setDonor(e.target.value)}
                  autoComplete="off"
                  className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm text-white outline-none focus:border-amber-400/50"
                />
              </label>
              <label className="block text-xs text-zinc-400">
                Сумма
                <input
                  value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                  inputMode="decimal"
                  className="tabular mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm text-white outline-none focus:border-amber-400/50"
                />
              </label>
              <label className="block text-xs text-zinc-400">
                Валюта
                <select
                  value={currency} onChange={(e) => setCurrency(e.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2 text-sm text-white"
                >
                  <option value="RUB">RUB</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </label>
              <button
                onClick={() => void donate(Number(amount))}
                className="pressable self-end rounded-lg border border-white/10 px-3 py-1.5 text-sm"
              >
                Отправить
              </button>
            </div>
            <label className="block max-w-prose text-xs text-zinc-400">
              Комментарий к донату (необязательно)
              <input
                value={message} onChange={(e) => setMessage(e.target.value)}
                autoComplete="off"
                className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm text-white outline-none focus:border-amber-400/50"
              />
            </label>
          </div>
        </div>
      )}

      {mode === 'unban' && (
        <div className="card p-4">
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            <label className="min-w-[200px] flex-1 text-xs text-zinc-400">
              Поиск по никнейму
              <input
                value={filter} onChange={(e) => setFilter(e.target.value)}
                autoComplete="off"
                className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm text-white outline-none focus:border-amber-400/50"
              />
            </label>
            <button
              onClick={() => void loadUnbans()}
              className="pressable self-end rounded-lg border border-white/10 px-3 py-1.5 text-sm"
            >
              Обновить заявки из Twitch
            </button>
            <Link to="/settings" className="self-end rounded-lg border border-white/10 px-3 py-1.5 text-sm text-zinc-200">
              В настройки
            </Link>
          </div>
          {visible.length === 0 ? (
            <p className="text-sm text-zinc-400">
              Нет активных заявок. Убедитесь, что токен модератора указан в настройках.
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-zinc-500">
                  <th scope="col" className="py-1 pr-2">Пользователь</th>
                  <th scope="col" className="py-1 pr-2">Текст апелляции</th>
                  <th scope="col" className="py-1 pr-2">Дата блокировки</th>
                  <th scope="col" className="py-1">Действие</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((u) => (
                  <tr key={u.id} className="border-t border-white/5 align-top">
                    <td className="py-2 pr-2 font-medium">{u.user}</td>
                    <td className="max-w-[420px] py-2 pr-2 text-zinc-300">{u.text}</td>
                    <td className="tabular py-2 pr-2 font-mono text-xs text-zinc-500">{u.created_at}</td>
                    <td className="whitespace-nowrap py-2">
                      <button
                        onClick={() => void openUnbanTrial(u)}
                        aria-label={`Рассмотреть ${u.user}`}
                        className="pressable mr-1 rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-xs"
                      >
                        Рассмотреть
                      </button>
                      <button
                        onClick={() => void resolve(u.id, true)}
                        aria-label={`Одобрить ${u.user}`}
                        className="pressable mr-1 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-xs"
                      >
                        Одобрить
                      </button>
                      <button
                        onClick={() => void resolve(u.id, false)}
                        aria-label={`Отклонить ${u.user}`}
                        className="pressable rounded-md border border-red-400/30 bg-red-400/10 px-2 py-1 text-xs"
                      >
                        Отклонить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="card space-y-2.5 p-4">
        <h2 className="font-semibold">Параметры суда</h2>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <label className="block text-xs text-zinc-400">
            Время защиты стримера: {defenseSec} с
            <input
              type="range" min={5} max={120} step={5} value={defenseSec}
              onChange={(e) => setDefenseSec(Number(e.target.value))}
              className="mt-1 w-full"
            />
          </label>
          <label className="block text-xs text-zinc-400">
            Время показаний: {testimonySec} с
            <input
              type="range" min={5} max={120} step={5} value={testimonySec}
              onChange={(e) => setTestimonySec(Number(e.target.value))}
              className="mt-1 w-full"
            />
          </label>
          <label className="block text-xs text-zinc-400">
            Имя судьи
            <input
              value={judgeName} onChange={(e) => setJudgeName(e.target.value)}
              autoComplete="off"
              className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm text-white outline-none"
            />
          </label>
          <label className="block text-xs text-zinc-400">
            Порог доната для суда над стримером, ₽ (0: выкл)
            <input
              value={streamerMin} onChange={(e) => setStreamerMin(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              className="tabular mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm text-white outline-none"
            />
          </label>
          <label className="block text-xs text-zinc-400">
            Платиновый донат (суд по требованию), ₽
            <input
              value={platinumMin} onChange={(e) => setPlatinumMin(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              className="tabular mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm text-white outline-none"
            />
          </label>
          <label className="block text-xs text-zinc-400">
            Характер судьи
            <select
              value={judgeStyle} onChange={(e) => setJudgeStyle(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2 text-sm text-white"
            >
              <option value="strict">Строгий</option>
              <option value="cynical">Циничный</option>
            </select>
          </label>
          <label className="block text-xs text-zinc-400">
            Тема оформления
            <input
              value={theme} onChange={(e) => setTheme(e.target.value)}
              autoComplete="off"
              className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm text-white outline-none"
            />
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            <label className="block text-xs text-zinc-400">
              !sue: порог участников (0: выкл)
              <input
                value={sueThreshold} onChange={(e) => setSueThreshold(e.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric"
                className="tabular mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm text-white outline-none"
              />
            </label>
            <label className="block text-xs text-zinc-400">
              !sue: временное окно, с
              <input
                value={sueWindow} onChange={(e) => setSueWindow(e.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric"
                className="tabular mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm text-white outline-none"
              />
            </label>
          </div>
          <label className="block text-xs text-zinc-400">
            Шаблоны статей для пульта (по одной в строке)
            <textarea
              value={articles} onChange={(e) => setArticles(e.target.value)}
              rows={5}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-sm text-white outline-none"
            />
          </label>
        </div>
        <button
          onClick={() => void saveParams()}
          className="pressable rounded-lg bg-amber-400/90 px-4 py-1.5 text-sm font-bold text-black"
        >
          Сохранить параметры
        </button>
      </div>
    </div>
  )
}
