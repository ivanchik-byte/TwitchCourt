import { useEffect, useState } from 'react'
import { apiGet, apiPut, apiPost } from '../lib/api'
import { getSecret, setSecret } from '../lib/api'
import { SecretField } from '../components/SecretField'

function roundTemp(v: number): number {
  return Number(v.toFixed(2))
}

export function SettingsView() {
  const [secret, setSecretLocal] = useState(getSecret())
  const [ai, setAi] = useState({ provider: 'groq', model: '', temperature: 0.85 })
  const [apiKey, setApiKey] = useState('')
  const [tts, setTts] = useState({ engine: 'edge', voice: '', rate: '-10%' })
  const [twitch, setTwitch] = useState({ channel: '', nick: '', token: '' })
  const [note, setNote] = useState('')
  const [sfx, setSfx] = useState<{ name: string; size: number }[]>([])

  useEffect(() => {
    void apiGet<{ provider: string; model: string; temperature: number }>('/api/ai').then((d) =>
      setAi({ provider: d.provider, model: d.model ?? '', temperature: roundTemp(d.temperature ?? 0.85) }),
    ).catch(() => undefined)
    void apiGet<{ engine: string; voice: string; rate: string }>('/api/tts').then((d) =>
      setTts({ engine: d.engine, voice: d.voice ?? '', rate: d.rate ?? '-10%' }),
    ).catch(() => undefined)
    void apiGet<{ channel: string; nick: string }>('/api/integrations').then((d) =>
      setTwitch((t) => ({ ...t, channel: d.channel ?? '', nick: d.nick ?? '' })),
    ).catch(() => undefined)
    void apiGet<{ sfx: { name: string; size: number }[] }>('/api/sfx').then((d) => setSfx(d.sfx ?? [])).catch(() => undefined)
  }, [])

  const saveAll = async () => {
    setSecret(secret)
    const results = await Promise.all([
      apiPut('/api/ai', { provider: ai.provider, model: ai.model, temperature: roundTemp(ai.temperature), ...(apiKey ? { api_key: apiKey } : {}) }),
      apiPut('/api/tts', { engine: tts.engine, voice: tts.voice, rate: tts.rate }),
      apiPut('/api/integrations', { channel: twitch.channel, nick: twitch.nick, ...(twitch.token ? { twitch_token: twitch.token } : {}) }),
    ])
    setNote(results.every(Boolean) ? 'Всё сохранено' : 'Что-то не сохранилось — проверь секретный ключ')
    setApiKey('')
    setTwitch((t) => ({ ...t, token: '' }))
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-3 p-3">
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <div className="min-w-[220px] flex-1">
          <SecretField label="Секретный ключ сервера" value={secret} onChange={setSecretLocal} placeholder="X-Secret" />
        </div>
        <button onClick={() => void saveAll()} className="pressable rounded-lg bg-amber-400/90 px-4 py-2 text-sm font-bold text-black">
          Сохранить всё
        </button>
        {note && <span className="text-xs text-zinc-400">{note}</span>}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <section className="card space-y-2 p-4">
          <h2 className="font-semibold">ИИ-Мозг</h2>
          <label className="block text-xs text-zinc-400">
            Провайдер
            <select value={ai.provider} onChange={(e) => setAi({ ...ai, provider: e.target.value })}
              className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2 text-sm text-white">
              <option value="groq">Groq</option>
              <option value="cerebras">Cerebras</option>
              <option value="ollama">Ollama</option>
            </select>
          </label>
          <SecretField label="API-ключ" value={apiKey} onChange={setApiKey} />
          <label className="block text-xs text-zinc-400">
            Модель
            <input value={ai.model} onChange={(e) => setAi({ ...ai, model: e.target.value })}
              className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm text-white outline-none" />
          </label>
          <label className="block text-xs text-zinc-400">
            Температура: {roundTemp(ai.temperature).toFixed(2)}
            <input type="range" min={0} max={1} step={0.05} value={ai.temperature}
              onChange={(e) => setAi({ ...ai, temperature: roundTemp(Number(e.target.value)) })}
              className="mt-1 w-full" />
          </label>
        </section>

        <section className="card space-y-2 p-4">
          <h2 className="font-semibold">Синтез речи</h2>
          <label className="block text-xs text-zinc-400">
            Движок
            <select value={tts.engine} onChange={(e) => setTts({ ...tts, engine: e.target.value })}
              className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2 text-sm text-white">
              <option value="edge">Edge</option>
              <option value="silero">Silero</option>
              <option value="piper">Piper</option>
              <option value="mock">Mock</option>
            </select>
          </label>
          <label className="block text-xs text-zinc-400">
            Голос
            <input value={tts.voice} onChange={(e) => setTts({ ...tts, voice: e.target.value })} placeholder="ru-RU-DmitryNeural"
              className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm text-white outline-none" />
          </label>
          <div className="flex gap-1.5">
            <button onClick={() => void apiPost('/api/say', { text: 'Проверка голоса судьи. Суд идёт.' })}
              className="pressable rounded-lg border border-white/10 px-3 py-1.5 text-sm">
              Прослушать голос
            </button>
            <span className="self-center font-mono text-xs text-zinc-500">{tts.rate}</span>
          </div>
        </section>

        <section className="card space-y-2 p-4">
          <h2 className="font-semibold">Twitch и донаты</h2>
          <label className="block text-xs text-zinc-400">
            Канал
            <input value={twitch.channel} onChange={(e) => setTwitch({ ...twitch, channel: e.target.value })}
              className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm text-white outline-none" />
          </label>
          <SecretField label="Twitch OAuth токен" value={twitch.token} onChange={(v) => setTwitch({ ...twitch, token: v })} />
        </section>

        <section className="card space-y-2 p-4">
          <h2 className="font-semibold">OBS Sandbox</h2>
          <div className="overflow-hidden rounded-lg border border-white/10">
            <iframe title="overlay preview" src="/overlay/" className="h-48 w-full bg-black" />
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => { void navigator.clipboard?.writeText(`${location.origin}/overlay/`); setNote('URL оверлея скопирован') }}
              className="pressable rounded-lg border border-white/10 px-3 py-1.5 text-sm">
              Скопировать URL для OBS
            </button>
          </div>
          <div className="space-y-1">
            {sfx.map((f) => (
              <div key={f.name} className="flex items-center gap-2 text-xs text-zinc-400">
                <span className="flex-1 truncate font-mono">{f.name}</span>
                <audio controls preload="none" src={`/overlay/sfx/${f.name}`} className="h-7 w-44" />
              </div>
            ))}
            {sfx.length === 0 && <p className="text-xs text-zinc-600">Сэмплов нет.</p>}
          </div>
        </section>
      </div>
    </div>
  )
}
