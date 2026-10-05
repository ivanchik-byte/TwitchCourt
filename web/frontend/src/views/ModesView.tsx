import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { apiGet, apiPost, apiPut } from '../lib/api'
import type { UnbanRequest } from '../lib/types'

const PRESETS = [100, 300, 500, 1000]

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

  const loadUnbans = async () => {
    try {
      const d = await apiGet<{ requests: UnbanRequest[] }>('/api/unban')
      setUnbans(d.requests ?? [])
    } catch {
      toast.error('Unban-суд недоступен — проверь секретный ключ')
    }
  }

  useEffect(() => {
    if (mode === 'unban') void loadUnbans()
  }, [mode])

  useEffect(() => {
    void apiGet<{ defense_sec: number; testimony_sec: number; streamer_trial_min: number; sue_threshold: number; sue_window_sec: number }>('/api/settings')
      .then((d) => {
        if (typeof d.defense_sec === 'number') setDefenseSec(d.defense_sec)
        if (typeof d.testimony_sec === 'number') setTestimonySec(d.testimony_sec)
        if (typeof d.streamer_trial_min === 'number') setStreamerMin(String(d.streamer_trial_min))
        if (typeof d.sue_threshold === 'number') setSueThreshold(String(d.sue_threshold))
        if (typeof d.sue_window_sec === 'number') setSueWindow(String(d.sue_window_sec))
      })
      .catch(() => undefined)
  }, [])

  const openTrial = async () => {
    const ok = await apiPost('/api/trial', {
      defendant: defendant.trim() || undefined,
      crime: crime.trim() || (mode === 'streamer' ? 'суд над стримером' : 'выбран залом'),
      context: context.trim() || undefined,
      viewer: mode !== 'streamer',
    })
    if (ok) toast.success('Дело открыто')
    else toast.error('Не вышло — проверь секретный ключ или зал занят')
  }

  const resolve = async (id: string, approve: boolean) => {
    const ok = await apiPost('/api/unban/resolve', { id, approve, text: '' })
    if (ok) toast.success(approve ? 'Помилован в Twitch' : 'Отклонено в Twitch')
    else toast.error('Не вышло — проверь токен модератора')
    void loadUnbans()
  }

  const donate = async (sum: number) => {
    if (!(sum > 0)) {
      toast.error('Сумма должна быть больше нуля')
      return
    }
    const ok = await apiPost('/api/donate', {
      donor: donor || 'anon',
      amount: sum,
      currency,
      message,
    })
    if (ok) toast.success(`Взятка ${sum} ${currency} учтена`)
    else toast.error('Донат не принят')
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
              ? 'Ничья — в пользу стримера. Донаты идут в счёт взятки судье.'
              : 'Классика: зритель на скамье по !court или вручную.'}
          </p>
          <div className="grid max-w-prose gap-1.5 sm:grid-cols-2">
            <input
              value={defendant}
              onChange={(e) => setDefendant(e.target.value)}
              placeholder={mode === 'streamer' ? 'Имя стримера' : 'Ник зрителя'}
              autoComplete="off"
              className="h-9 rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm outline-none focus:border-amber-400/50"
            />
            <input
              value={crime}
              onChange={(e) => setCrime(e.target.value)}
              placeholder="Статья обвинения"
              autoComplete="off"
              className="h-9 rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm outline-none focus:border-amber-400/50"
            />
          </div>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="Контекст дела: что случилось, свидетели, отягчающие"
            rows={2}
            className="w-full max-w-prose rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-sm outline-none focus:border-amber-400/50"
          />
          <button
            onClick={() => void openTrial()}
            className="pressable rounded-lg bg-amber-400/90 px-4 py-2 text-sm font-bold text-black"
          >
            Открыть дело
          </button>

          <div className="space-y-1.5 border-t border-white/5 pt-2.5">
            <p className="text-[11px] uppercase tracking-widest text-zinc-500">Симулятор взятки судье</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => void donate(p)}
                  className="pressable rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs"
                >
                  {p} ₽
                </button>
              ))}
            </div>
            <div className="grid max-w-prose gap-1.5 sm:grid-cols-[1fr_110px_96px_auto]">
              <input
                value={donor}
                onChange={(e) => setDonor(e.target.value)}
                placeholder="Кто платит"
                autoComplete="off"
                className="h-9 rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm outline-none focus:border-amber-400/50"
              />
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="Сумма"
                inputMode="decimal"
                className="tabular h-9 rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm outline-none focus:border-amber-400/50"
              />
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="h-9 rounded-lg border border-white/10 bg-black/40 px-2 text-sm text-white"
              >
                <option value="RUB">RUB</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
              <button
                onClick={() => void donate(Number(amount))}
                className="pressable rounded-lg border border-white/10 px-3 py-1.5 text-sm"
              >
                Дать
              </button>
            </div>
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Сообщение взятки (необязательно)"
              autoComplete="off"
              className="h-9 w-full max-w-prose rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm outline-none focus:border-amber-400/50"
            />
          </div>
        </div>
      )}

      {mode === 'unban' && (
        <div className="card p-4">
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Фильтр по нику…"
              autoComplete="off"
              className="h-9 min-w-[200px] flex-1 rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm outline-none focus:border-amber-400/50"
            />
            <button
              onClick={() => void loadUnbans()}
              className="pressable rounded-lg border border-white/10 px-3 py-1.5 text-sm"
            >
              Опросить Twitch API
            </button>
            <a href="/settings" className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-zinc-200">
              В настройки
            </a>
          </div>
          {visible.length === 0 ? (
            <p className="text-sm text-zinc-400">
              Заявок нет. Нужен токен модератора в конфиге.
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-zinc-500">
                  <th className="py-1 pr-2">Юзер</th>
                  <th className="py-1 pr-2">Апелляция</th>
                  <th className="py-1 pr-2">Дата бана</th>
                  <th className="py-1">Решение</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((u) => (
                  <tr key={u.id} className="border-t border-white/5 align-top">
                    <td className="py-2 pr-2 font-medium">{u.user}</td>
                    <td className="max-w-[420px] py-2 pr-2 text-zinc-300">
                      {u.text}
                      {u.messages?.length ? (
                        <details className="mt-1 text-xs text-zinc-500">
                          <summary className="cursor-pointer">Последние сообщения ({u.messages.length})</summary>
                          {u.messages.slice(-5).map((m, i) => (
                            <p key={i}>— {m}</p>
                          ))}
                        </details>
                      ) : null}
                    </td>
                    <td className="tabular py-2 pr-2 font-mono text-xs text-zinc-500">{u.created_at}</td>
                    <td className="whitespace-nowrap py-2">
                      <button
                        onClick={async () => {
                          try {
                            const ok = await apiPost('/api/unban/trial', { id: u.id })
                            if (ok) toast.success(`Unban-суд открыт: ${u.user}. Ты — обвинитель, микрофон твой`)
                            else toast.error('Зал занят — дождись конца дела')
                          } catch {
                            toast.error('Не вышло — проверь секретный ключ')
                          }
                        }}
                        className="pressable mr-1 rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-xs"
                      >
                        Судить
                      </button>
                      <button
                        onClick={() => void resolve(u.id, true)}
                        className="pressable mr-1 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-xs"
                      >
                        Помиловать
                      </button>
                      <button
                        onClick={() => void resolve(u.id, false)}
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
            Время защиты стримера: {defenseSec}с
            <input
              type="range" min={5} max={120} step={5} value={defenseSec}
              onChange={(e) => setDefenseSec(Number(e.target.value))}
              className="mt-1 w-full"
            />
          </label>
          <label className="block text-xs text-zinc-400">
            Время показаний: {testimonySec}с
            <input
              type="range" min={5} max={120} step={5} value={testimonySec}
              onChange={(e) => setTestimonySec(Number(e.target.value))}
              className="mt-1 w-full"
            />
          </label>
          <label className="block text-xs text-zinc-400">
            Донат для суда над стримером, ₽ (0 — выкл)
            <input
              value={streamerMin}
              onChange={(e) => setStreamerMin(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              className="tabular mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm text-white outline-none"
            />
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            <label className="block text-xs text-zinc-400">
              !sue: людей (0 — выкл)
              <input
                value={sueThreshold}
                onChange={(e) => setSueThreshold(e.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric"
                className="tabular mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm text-white outline-none"
              />
            </label>
            <label className="block text-xs text-zinc-400">
              !sue: окно, сек
              <input
                value={sueWindow}
                onChange={(e) => setSueWindow(e.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric"
                className="tabular mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm text-white outline-none"
              />
            </label>
          </div>
        </div>
        <button
          onClick={async () => {
            try {
              const ok = await apiPut('/api/settings', {
                defense_sec: defenseSec,
                testimony_sec: testimonySec,
                streamer_trial_min: Number(streamerMin) || 0,
                sue_threshold: Number(sueThreshold) || 0,
                sue_window_sec: Number(sueWindow) || 600,
              })
              if (ok) toast.success('Параметры суда сохранены')
              else toast.error('Не сохранилось — проверь секретный ключ')
            } catch {
              toast.error('Ошибка сети')
            }
          }}
          className="pressable rounded-lg bg-amber-400/90 px-4 py-1.5 text-sm font-bold text-black"
        >
          Сохранить параметры
        </button>
      </div>
    </div>
  )
}
