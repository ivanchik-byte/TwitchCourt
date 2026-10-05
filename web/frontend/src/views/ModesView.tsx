import { useEffect, useState } from 'react'
import { apiGet, apiPost } from '../lib/api'
import type { UnbanRequest } from '../lib/types'

const PRESETS = [100, 500, 1000]

export function ModesView() {
  const [mode, setMode] = useState<'viewer' | 'streamer' | 'unban'>('viewer')
  const [unbans, setUnbans] = useState<UnbanRequest[]>([])
  const [streamer, setStreamer] = useState('')
  const [donor, setDonor] = useState('')
  const [note, setNote] = useState('')

  const loadUnbans = async () => {
    try {
      const d = await apiGet<{ requests: UnbanRequest[] }>('/api/unban')
      setUnbans(d.requests ?? [])
    } catch {
      /* offline */
    }
  }

  useEffect(() => {
    if (mode === 'unban') void loadUnbans()
  }, [mode])

  const resolve = async (id: string, approve: boolean) => {
    const ok = await apiPost('/api/unban/resolve', { id, approve, text: '' })
    setNote(ok ? (approve ? 'Помилован в Twitch' : 'Отклонено в Twitch') : 'Не вышло — проверь токен модератора')
    void loadUnbans()
  }

  const donate = async (amount: number) => {
    const ok = await apiPost('/api/donate', { donor: donor || 'anon', amount, currency: 'RUB', message: '' })
    setNote(ok ? `Взятка ${amount} ₽ учтена` : 'Донат не принят')
  }

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
        <div className="card space-y-2 p-4">
          <p className="text-sm text-zinc-400">
            {mode === 'streamer' ? 'Ничья — в пользу стримера. Донаты идут в счёт взятки судье.' : 'Классика: зритель на скамье по !court или вручную.'}
          </p>
          <div className="grid max-w-prose gap-1.5 sm:grid-cols-2">
            <input value={mode === 'streamer' ? streamer : donor} onChange={(e) => (mode === 'streamer' ? setStreamer(e.target.value) : setDonor(e.target.value))}
              placeholder={mode === 'streamer' ? 'Имя стримера' : 'Ник зрителя'} autoComplete="off"
              className="h-9 rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm outline-none focus:border-amber-400/50" />
            <button onClick={() => void apiPost('/api/trial', { defendant: (mode === 'streamer' ? streamer : donor) || undefined, crime: mode === 'streamer' ? 'суд над стримером' : 'выбран залом', viewer: mode !== 'streamer' })}
              className="pressable rounded-lg bg-amber-400/90 px-3 py-2 text-sm font-bold text-black">
              Открыть дело
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-zinc-500">Симулятор взятки:</span>
            {PRESETS.map((p) => (
              <button key={p} onClick={() => void donate(p)} className="pressable rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs">
                {p} ₽
              </button>
            ))}
          </div>
          {note && <p className="text-xs text-zinc-400">{note}</p>}
        </div>
      )}

      {mode === 'unban' && (
        <div className="card p-4">
          {unbans.length === 0 ? (
            <div className="space-y-2 text-sm text-zinc-400">
              <p>Заявок нет. Нужен токен модератора в конфиге.</p>
              <div className="flex gap-1.5">
                <button onClick={() => void loadUnbans()} className="pressable rounded-lg border border-white/10 px-3 py-1.5 text-sm">
                  Опросить Twitch API
                </button>
                <a href="/settings" className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-zinc-200">В настройки</a>
              </div>
            </div>
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
                {unbans.map((u) => (
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
                    <td className="py-2 pr-2 font-mono text-xs text-zinc-500">{u.created_at}</td>
                    <td className="whitespace-nowrap py-2">
                      <button onClick={() => void resolve(u.id, true)} className="pressable mr-1 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-xs">Помиловать</button>
                      <button onClick={() => void resolve(u.id, false)} className="pressable rounded-md border border-red-400/30 bg-red-400/10 px-2 py-1 text-xs">Отклонить</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {note && <p className="mt-2 text-xs text-zinc-400">{note}</p>}
        </div>
      )}
    </div>
  )
}
