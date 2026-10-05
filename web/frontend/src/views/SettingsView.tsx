import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { apiGet, apiPut, apiPost, apiUpload } from '../lib/api'
import { getSecret, setSecret } from '../lib/api'
import { SecretField } from '../components/SecretField'

function roundTemp(v: number): number {
  return Number(v.toFixed(2))
}

function lines(v: string): string[] {
  return v
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

const VOICE_PRESETS = ['ru-RU-DmitryNeural', 'ru-RU-SvetlanaNeural', 'custom']
const JUDGE_STATES = [
  { state: 'normal', label: 'Спокойный' },
  { state: 'angry', label: 'Злой' },
  { state: 'gavel', label: 'С молотком' },
] as const

const inputCls =
  'mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm text-white outline-none focus:border-amber-400/50'
const labelCls = 'block text-xs text-zinc-400'

async function saveSection(name: string, fn: () => Promise<boolean>) {
  try {
    if (await fn()) toast.success(`${name}: сохранено`)
    else toast.error(`${name}: не сохранилось — проверь секретный ключ`)
  } catch {
    toast.error(`${name}: ошибка сети`)
  }
}

export function SettingsView() {
  const [secret, setSecretLocal] = useState(getSecret())

  const [ai, setAi] = useState({ provider: 'groq', model: '', temperature: 0.85, baseUrl: '' })
  const [apiKey, setApiKey] = useState('')
  const [aiFlags, setAiFlags] = useState<{ has_key: boolean; live: boolean } | null>(null)

  const [tts, setTts] = useState({
    engine: 'edge',
    voice: 'ru-RU-DmitryNeural',
    customVoice: '',
    rate: '-10%',
    volume: '',
    pitch: '',
    judgeVoice: '',
    judgeRate: '',
    sileroUrl: '',
  })

  const [twitch, setTwitch] = useState({
    channel: '',
    nick: '',
    token: '',
    clientId: '',
    broadcasterId: '',
    daToken: '',
    dpKey: '',
  })
  const [twitchHas, setTwitchHas] = useState<Record<string, boolean>>({})

  const [profile, setProfile] = useState({
    name: '',
    mercy: '',
    titles: '',
    traits: '',
    gags: '',
    notes: '',
  })

  const [sfx, setSfx] = useState<{ name: string; size: number }[]>([])
  const [photoTick, setPhotoTick] = useState(0)

  useEffect(() => {
    setSecret(secret)
    void apiGet<{ provider: string; model: string; temperature: number; base_url: string; has_key: boolean; live: boolean }>('/api/ai')
      .then((d) => {
        setAi({
          provider: d.provider,
          model: d.model ?? '',
          temperature: roundTemp(d.temperature ?? 0.85),
          baseUrl: d.base_url ?? '',
        })
        setAiFlags({ has_key: d.has_key, live: d.live })
      })
      .catch(() => undefined)
    void apiGet<{
      engine: string; voice: string; rate: string; volume: string; pitch: string
      judge_voice: string; judge_rate: string; silero_url: string
    }>('/api/tts')
      .then((d) =>
        setTts((t) => ({
          ...t,
          engine: d.engine,
          voice: VOICE_PRESETS.includes(d.voice) ? d.voice : 'custom',
          customVoice: VOICE_PRESETS.includes(d.voice) ? '' : (d.voice ?? ''),
          rate: d.rate ?? '-10%',
          volume: d.volume ?? '',
          pitch: d.pitch ?? '',
          judgeVoice: d.judge_voice ?? '',
          judgeRate: d.judge_rate ?? '',
          sileroUrl: d.silero_url ?? '',
        })),
      )
      .catch(() => undefined)
    void apiGet<Record<string, string | boolean>>('/api/integrations')
      .then((d) => {
        setTwitch((t) => ({ ...t, channel: String(d.channel ?? ''), nick: String(d.nick ?? '') }))
        setTwitchHas({
          twitch_token: d.twitch === true,
          donationalerts_token: d.donationalerts === true,
          donatepay_key: d.donatepay === true,
        })
      })
      .catch(() => undefined)
    void apiGet<{ name: string; titles: string[]; traits: string[]; running_gags: string[]; mercy: string; auto_notes: string[] }>('/api/profile')
      .then((d) =>
        setProfile({
          name: d.name ?? '',
          mercy: d.mercy ?? '',
          titles: (d.titles ?? []).join('\n'),
          traits: (d.traits ?? []).join('\n'),
          gags: (d.running_gags ?? []).join('\n'),
          notes: (d.auto_notes ?? []).join('\n'),
        }),
      )
      .catch(() => undefined)
    void apiGet<{ sfx: { name: string; size: number }[] }>('/api/sfx')
      .then((d) => setSfx(d.sfx ?? []))
      .catch(() => undefined)
  }, [secret])

  const effectiveVoice = tts.voice === 'custom' ? tts.customVoice : tts.voice

  const uploadPhoto = async (state: string, file: File | undefined) => {
    if (!file) return
    const form = new FormData()
    form.append('photo', file)
    const ok = await apiUpload(`/api/judge/photo?state=${encodeURIComponent(state)}`, form)
    if (ok) {
      toast.success('Фото судьи обновлено')
      setPhotoTick((n) => n + 1)
    } else {
      toast.error('Загрузка не удалась — проверь секретный ключ')
    }
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-3 p-3">
      <div className="card p-3">
        <div className="min-w-[220px] max-w-prose">
          <SecretField label="Секретный ключ сервера" value={secret} onChange={setSecretLocal} placeholder="X-Secret" />
        </div>
      </div>

      <div className="grid items-start gap-3 md:grid-cols-2">
        <section className="card space-y-2 p-4">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">ИИ-Мозг</h2>
            {aiFlags && (
              <span className={`font-mono text-xs ${aiFlags.live ? 'text-emerald-300' : 'text-zinc-500'}`}>
                {aiFlags.live ? '● live' : '○ mock'}
              </span>
            )}
          </div>
          <label className={labelCls}>
            Провайдер
            <select
              value={ai.provider}
              onChange={(e) => setAi({ ...ai, provider: e.target.value })}
              className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2 text-sm text-white"
            >
              <option value="groq">Groq</option>
              <option value="cerebras">Cerebras</option>
              <option value="ollama">Ollama (локально)</option>
            </select>
          </label>
          {ai.provider === 'ollama' ? (
            <label className={labelCls}>
              URL Ollama
              <input
                value={ai.baseUrl}
                onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })}
                placeholder="http://localhost:11434"
                className={inputCls}
              />
            </label>
          ) : (
            <SecretField label="API-ключ" value={apiKey} onChange={setApiKey} />
          )}
          <label className={labelCls}>
            Модель
            <input value={ai.model} onChange={(e) => setAi({ ...ai, model: e.target.value })} className={inputCls} />
          </label>
          <label className={labelCls}>
            Температура: {roundTemp(ai.temperature).toFixed(2)}
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={ai.temperature}
              onChange={(e) => setAi({ ...ai, temperature: roundTemp(Number(e.target.value)) })}
              className="mt-1 w-full"
            />
          </label>
          <div className="flex gap-1.5">
            <button
              onClick={() =>
                saveSection('ИИ-Мозг', () =>
                  apiPut('/api/ai', {
                    provider: ai.provider,
                    model: ai.model,
                    temperature: roundTemp(ai.temperature),
                    base_url: ai.baseUrl,
                    ...(apiKey ? { api_key: apiKey } : {}),
                  }).then((ok) => {
                    if (ok) setApiKey('')
                    return ok
                  })
                )
              }
              className="pressable rounded-lg bg-amber-400/90 px-4 py-1.5 text-sm font-bold text-black"
            >
              Сохранить
            </button>
            <button
              onClick={async () => {
                const t0 = Date.now()
                try {
                  const d = await apiGet<{ live: boolean; provider: string; model: string }>('/api/ai')
                  toast.success(`Ping AI: ${Date.now() - t0}мс · ${d.provider}/${d.model || 'default'} · ${d.live ? 'live' : 'mock'}`)
                } catch {
                  toast.error('AI недоступен')
                }
              }}
              className="pressable rounded-lg border border-white/10 px-3 py-1.5 text-sm"
            >
              Ping AI
            </button>
          </div>
        </section>

        <section className="card space-y-2 p-4">
          <h2 className="font-semibold">Синтез речи</h2>
          <label className={labelCls}>
            Движок
            <select
              value={tts.engine}
              onChange={(e) => setTts({ ...tts, engine: e.target.value })}
              className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2 text-sm text-white"
            >
              <option value="edge">Edge</option>
              <option value="silero">Silero</option>
              <option value="piper">Piper</option>
              <option value="mock">Mock</option>
            </select>
          </label>
          <label className={labelCls}>
            Голос
            <select
              value={tts.voice}
              onChange={(e) => setTts({ ...tts, voice: e.target.value })}
              className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2 text-sm text-white"
            >
              <option value="ru-RU-DmitryNeural">ru-RU-DmitryNeural</option>
              <option value="ru-RU-SvetlanaNeural">ru-RU-SvetlanaNeural</option>
              <option value="custom">Свой…</option>
            </select>
          </label>
          {tts.voice === 'custom' && (
            <label className={labelCls}>
              Свой голос
              <input
                value={tts.customVoice}
                onChange={(e) => setTts({ ...tts, customVoice: e.target.value })}
                placeholder="ru-RU-…"
                className={inputCls}
              />
            </label>
          )}
          <div className="grid grid-cols-3 gap-1.5">
            <label className={labelCls}>
              Темп
              <input value={tts.rate} onChange={(e) => setTts({ ...tts, rate: e.target.value })} placeholder="-10%" className={inputCls} />
            </label>
            <label className={labelCls}>
              Громкость
              <input value={tts.volume} onChange={(e) => setTts({ ...tts, volume: e.target.value })} placeholder="+0%" className={inputCls} />
            </label>
            <label className={labelCls}>
              Тон
              <input value={tts.pitch} onChange={(e) => setTts({ ...tts, pitch: e.target.value })} placeholder="+0Hz" className={inputCls} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <label className={labelCls}>
              Голос судьи
              <input value={tts.judgeVoice} onChange={(e) => setTts({ ...tts, judgeVoice: e.target.value })} className={inputCls} />
            </label>
            <label className={labelCls}>
              Темп судьи
              <input value={tts.judgeRate} onChange={(e) => setTts({ ...tts, judgeRate: e.target.value })} className={inputCls} />
            </label>
          </div>
          {tts.engine === 'silero' && (
            <label className={labelCls}>
              Silero URL
              <input value={tts.sileroUrl} onChange={(e) => setTts({ ...tts, sileroUrl: e.target.value })} className={inputCls} />
            </label>
          )}
          <div className="flex gap-1.5">
            <button
              onClick={() =>
                saveSection('TTS', () =>
                  apiPut('/api/tts', {
                    engine: tts.engine,
                    voice: effectiveVoice,
                    rate: tts.rate,
                    volume: tts.volume,
                    pitch: tts.pitch,
                    judge_voice: tts.judgeVoice,
                    judge_rate: tts.judgeRate,
                    silero_url: tts.sileroUrl,
                  })
                )
              }
              className="pressable rounded-lg bg-amber-400/90 px-4 py-1.5 text-sm font-bold text-black"
            >
              Сохранить
            </button>
            <button
              onClick={() => void apiPost('/api/say', { text: 'Проверка голоса судьи. Суд идёт.' })}
              className="pressable rounded-lg border border-white/10 px-3 py-1.5 text-sm"
            >
              Прослушать голос
            </button>
          </div>
        </section>

        <section className="card space-y-2 p-4">
          <h2 className="font-semibold">Интеграции</h2>
          <div className="grid grid-cols-2 gap-1.5">
            <label className={labelCls}>
              Канал
              <input value={twitch.channel} onChange={(e) => setTwitch({ ...twitch, channel: e.target.value })} className={inputCls} />
            </label>
            <label className={labelCls}>
              Ник бота
              <input value={twitch.nick} onChange={(e) => setTwitch({ ...twitch, nick: e.target.value })} className={inputCls} />
            </label>
          </div>
          <SecretField label={`Twitch OAuth${twitchHas.twitch_token ? ' ● задан' : ''}`} value={twitch.token} onChange={(v) => setTwitch({ ...twitch, token: v })} />
          <SecretField label="Twitch Client ID" value={twitch.clientId} onChange={(v) => setTwitch({ ...twitch, clientId: v })} />
          <SecretField label="Broadcaster ID (для Unban-суда)" value={twitch.broadcasterId} onChange={(v) => setTwitch({ ...twitch, broadcasterId: v })} />
          <SecretField label={`DonationAlerts токен${twitchHas.donationalerts_token ? ' ● задан' : ''}`} value={twitch.daToken} onChange={(v) => setTwitch({ ...twitch, daToken: v })} />
          <SecretField label={`DonatePay ключ${twitchHas.donatepay_key ? ' ● задан' : ''}`} value={twitch.dpKey} onChange={(v) => setTwitch({ ...twitch, dpKey: v })} />
          <div>
            <button
              onClick={() =>
                saveSection('Интеграции', () =>
                  apiPut('/api/integrations', {
                    channel: twitch.channel,
                    nick: twitch.nick,
                    ...(twitch.token ? { twitch_token: twitch.token } : {}),
                    ...(twitch.clientId ? { client_id: twitch.clientId } : {}),
                    ...(twitch.broadcasterId ? { broadcaster_id: twitch.broadcasterId } : {}),
                    ...(twitch.daToken ? { donationalerts_token: twitch.daToken } : {}),
                    ...(twitch.dpKey ? { donatepay_key: twitch.dpKey } : {}),
                  }).then((ok) => {
                    if (ok) setTwitch((t) => ({ ...t, token: '', clientId: '', broadcasterId: '', daToken: '', dpKey: '' }))
                    return ok
                  })
                )
              }
              className="pressable rounded-lg bg-amber-400/90 px-4 py-1.5 text-sm font-bold text-black"
            >
              Сохранить
            </button>
          </div>
        </section>

        <section className="card space-y-2 p-4">
          <h2 className="font-semibold">Профиль стримера и характер судьи</h2>
          <label className={labelCls}>
            Имя стримера
            <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} className={inputCls} />
          </label>
          <label className={labelCls}>
            Милосердие судьи
            <input value={profile.mercy} onChange={(e) => setProfile({ ...profile, mercy: e.target.value })} placeholder="строг, но справедлив" className={inputCls} />
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            <label className={labelCls}>
              Титулы (по строке)
              <textarea value={profile.titles} onChange={(e) => setProfile({ ...profile, titles: e.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-sm text-white outline-none" />
            </label>
            <label className={labelCls}>
              Черты характера (по строке)
              <textarea value={profile.traits} onChange={(e) => setProfile({ ...profile, traits: e.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-sm text-white outline-none" />
            </label>
            <label className={labelCls}>
              Фирменные приколы (по строке)
              <textarea value={profile.gags} onChange={(e) => setProfile({ ...profile, gags: e.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-sm text-white outline-none" />
            </label>
            <label className={labelCls}>
              Автозаметки (по строке)
              <textarea value={profile.notes} onChange={(e) => setProfile({ ...profile, notes: e.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-sm text-white outline-none" />
            </label>
          </div>
          <div>
            <button
              onClick={() =>
                saveSection('Профиль', () =>
                  apiPut('/api/profile', {
                    name: profile.name,
                    mercy: profile.mercy,
                    titles: lines(profile.titles),
                    traits: lines(profile.traits),
                    running_gags: lines(profile.gags),
                    auto_notes: lines(profile.notes),
                  })
                )
              }
              className="pressable rounded-lg bg-amber-400/90 px-4 py-1.5 text-sm font-bold text-black"
            >
              Сохранить
            </button>
          </div>
        </section>

        <section className="card space-y-2 p-4">
          <h2 className="font-semibold">Лица судьи для оверлея</h2>
          <div className="grid grid-cols-3 gap-1.5">
            {JUDGE_STATES.map(({ state, label }) => (
              <label key={state} className="block cursor-pointer text-center text-xs text-zinc-400">
                <img
                  src={`/api/judge/photo?state=${state}&t=${photoTick}`}
                  alt={label}
                  className="mb-1 aspect-square w-full rounded-lg border border-white/10 bg-black/40 object-cover"
                  onError={(e) => {
                    ;(e.target as HTMLImageElement).style.opacity = '0.25'
                  }}
                />
                {label}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void uploadPhoto(state, e.target.files?.[0])}
                />
              </label>
            ))}
          </div>
        </section>

        <section className="card space-y-2 p-4">
          <h2 className="font-semibold">OBS Sandbox</h2>
          <div className="overflow-hidden rounded-lg border border-white/10">
            <iframe title="overlay preview" src="/overlay/" className="h-48 w-full bg-black" />
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(`${location.origin}/overlay/`)
                toast.success('URL оверлея скопирован')
              }}
              className="pressable rounded-lg border border-white/10 px-3 py-1.5 text-sm"
            >
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
