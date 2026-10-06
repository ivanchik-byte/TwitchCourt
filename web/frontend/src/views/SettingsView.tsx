import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { apiGet, apiPut, apiPost, apiPostJson, apiUpload, apiFetch, apiNote } from '../lib/api'
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

interface VoiceLists {
  edge: string[]
  silero: string[]
}

const inputCls =
  'mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 text-sm text-white outline-none focus:border-amber-400/50'
const labelCls = 'block text-xs text-zinc-400'

async function saveSection(name: string, fn: () => Promise<{ ok: boolean; status: number }>) {
  try {
    const r = await fn()
    if (r.ok) toast.success(`${name}: сохранено`)
    else toast.error(`${name}: ${apiNote(r.status)}`)
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
    voice: 'ru-RU-SvetlanaNeural',
    customVoice: '',
    sileroJudge: 'xenia',
    rate: '-10%',
    volume: '',
    pitch: '',
    judgeVoice: '',
    judgeRate: '',
    sileroUrl: '',
    enabled: true,
    autoFallback: true,
    piperBinary: '',
    modelPath: '',
    configPath: '',
    speakerId: '0',
    speed: '1.15',
    beep: false,
  })

  const [twitch, setTwitch] = useState({
    channel: '',
    nick: '',
    token: '',
    clientId: '',
    broadcasterId: '',
    moderatorId: '',
    daToken: '',
    dpKey: '',
    daEnabled: true,
    dpEnabled: true,
    bitsEnabled: true,
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
  const [courtTick, setCourtTick] = useState(0)
  const [voices, setVoices] = useState<VoiceLists>({ edge: [], silero: [] })
  const [safety, setSafety] = useState({ filterEnabled: true, blacklist: '', panicHotkey: 'escape' })
  const [streamerName, setStreamerName] = useState('')
  const [server, setServer] = useState({ host: '', port: 0, secretSet: false })

  useEffect(() => {
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
      judge_voice: string; judge_rate: string; silero_url: string; silero_judge: string
      enabled: boolean; auto_fallback: boolean; piper_binary: string; model_path: string
      config_path: string; speaker_id: number; speed: number; beep?: boolean
      voices?: { edge?: string[]; silero?: string[] }
    }>('/api/tts')
      .then((d) => {
        const edge = Array.isArray(d.voices?.edge) ? d.voices.edge : []
        const silero = Array.isArray(d.voices?.silero) ? d.voices.silero : []
        setVoices({ edge, silero })
        setTts((t) => ({
          ...t,
          engine: d.engine,
          voice: edge.includes(d.voice) ? d.voice : 'custom',
          customVoice: edge.includes(d.voice) ? '' : (d.voice ?? ''),
          sileroJudge: silero.includes(d.silero_judge) ? d.silero_judge : (d.silero_judge || 'xenia'),
          rate: d.rate ?? '-10%',
          volume: d.volume ?? '',
          pitch: d.pitch ?? '',
          judgeVoice: d.judge_voice ?? '',
          judgeRate: d.judge_rate ?? '',
          sileroUrl: d.silero_url ?? '',
          enabled: d.enabled ?? true,
          autoFallback: d.auto_fallback ?? true,
          piperBinary: d.piper_binary ?? '',
          modelPath: d.model_path ?? '',
          configPath: d.config_path ?? '',
          speakerId: String(d.speaker_id ?? 0),
          speed: String(d.speed ?? 1.15),
          beep: d.beep ?? false,
        }))
      })
      .catch(() => undefined)
    void apiGet<Record<string, string | boolean>>('/api/integrations')
      .then((d) => {
        setTwitch((t) => ({
          ...t,
          channel: String(d.channel ?? ''),
          nick: String(d.nick ?? ''),
          daEnabled: d.donationalerts_enabled !== false,
          dpEnabled: d.donatepay_enabled !== false,
          bitsEnabled: d.twitch_bits_enabled !== false,
        }))
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
    void apiGet<{ filter_enabled: boolean; custom_blacklist: string[]; panic_hotkey: string }>('/api/safety')
      .then((d) => setSafety({
        filterEnabled: d.filter_enabled !== false,
        blacklist: (d.custom_blacklist ?? []).join('\n'),
        panicHotkey: d.panic_hotkey || 'escape',
      }))
      .catch(() => undefined)
    void apiGet<{ streamer_name: string }>('/api/game')
      .then((d) => setStreamerName(d.streamer_name ?? ''))
      .catch(() => undefined)
    void apiGet<{ host: string; port: number; secret_set: boolean }>('/api/server')
      .then((d) => setServer({ host: d.host ?? '', port: d.port ?? 0, secretSet: !!d.secret_set }))
      .catch(() => undefined)
  }, [])

  const effectiveVoice = tts.voice === 'custom' ? tts.customVoice : tts.voice

  const uploadPhoto = async (file: File | undefined) => {
    if (!file) return
    const form = new FormData()
    form.append('photo', file)
    const ok = await apiUpload('/api/judge/photo', form)
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
          <SecretField label="Секретный ключ сервера (применяется при уходе с поля)" value={secret} onChange={setSecretLocal} onCommit={(v) => { setSecretLocal(v); setSecret(v) }} placeholder="X-Secret" />
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
                  }).then((r) => {
                    if (r.ok) setApiKey('')
                    return r
                  })
                )
              }
              className="pressable rounded-lg bg-amber-400/90 px-4 py-1.5 text-sm font-bold text-black"
            >
              Сохранить
            </button>
            <button
              onClick={async () => {
                const r = await apiPostJson<{ ms: number; mock: boolean }>('/api/ai/ping', {})
                if (!r.ok || !r.data) {
                  toast.error(`AI пинг: ${apiNote(r.status)}`)
                  return
                }
                toast.success(r.data.mock ? 'AI в mock-режиме — инференса нет' : `AI отвечает: ${r.data.ms}мс до первого токена`)
              }}
              className="pressable rounded-lg border border-white/10 px-3 py-1.5 text-sm"
            >
              Ping AI
            </button>
          </div>
        </section>

        <section className="card space-y-2 p-4">
          <h2 className="font-semibold">Синтез речи</h2>
          {tts.beep && (
            <div className="rounded-lg border border-amber-400/30 bg-amber-400/[0.08] p-2.5 text-xs text-amber-200">
              Сейчас вместо голоса — писк-заглушка: движок выключен или бинарь/модель не найдены. Проверь движок и пути ниже.
            </div>
          )}
          <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/[0.07] p-2.5 text-xs text-zinc-300">
            <span className="font-semibold text-emerald-200">Локальный ♀:</span> движок Silero + голос{' '}
            <span className="font-mono text-emerald-200">{tts.sileroJudge || 'xenia'}</span> — самый человеческий русский голос,
            работает офлайн и грузит ПК только в момент озвучки.
          </div>
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
              {voices.edge.map((v) => (
                <option key={v} value={v}>{v}{v.includes('Svetlana') ? ' ♀' : ''}</option>
              ))}
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
            <label className={labelCls}>
              Голос Silero
              <select
                value={tts.sileroJudge}
                onChange={(e) => setTts({ ...tts, sileroJudge: e.target.value })}
                className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2 text-sm text-white"
              >
                {voices.silero.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
                {!voices.silero.includes(tts.sileroJudge) && (
                  <option value={tts.sileroJudge}>{tts.sileroJudge} (с сервера)</option>
                )}
              </select>
            </label>
          {tts.engine === 'silero' && (
            <label className={labelCls}>
              Silero URL
              <input value={tts.sileroUrl} onChange={(e) => setTts({ ...tts, sileroUrl: e.target.value })} className={inputCls} />
            </label>
          )}
          {tts.engine === 'piper' && (
            <details className="rounded-lg border border-white/10 p-2.5">
              <summary className="cursor-pointer text-xs text-zinc-300">Piper локально (требует рестарта бинарника при смене путей)</summary>
              <div className="mt-2 space-y-2">
                <label className={labelCls}>
                  Путь к бинарнику
                  <input value={tts.piperBinary} onChange={(e) => setTts({ ...tts, piperBinary: e.target.value })} placeholder="bin/piper" className={inputCls} />
                </label>
                <label className={labelCls}>
                  Модель (.onnx, irina — женский)
                  <input value={tts.modelPath} onChange={(e) => setTts({ ...tts, modelPath: e.target.value })} className={inputCls} />
                </label>
                <label className={labelCls}>
                  Конфиг модели (.json)
                  <input value={tts.configPath} onChange={(e) => setTts({ ...tts, configPath: e.target.value })} className={inputCls} />
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  <label className={labelCls}>
                    Speaker ID
                    <input value={tts.speakerId} onChange={(e) => setTts({ ...tts, speakerId: e.target.value.replace(/[^0-9]/g, '') })} inputMode="numeric" className={inputCls} />
                  </label>
                  <label className={labelCls}>
                    Скорость
                    <input value={tts.speed} onChange={(e) => setTts({ ...tts, speed: e.target.value.replace(/[^0-9.]/g, '') })} inputMode="decimal" className={inputCls} />
                  </label>
                </div>
              </div>
            </details>
          )}
          <div className="flex flex-wrap gap-3 text-xs text-zinc-300">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={tts.enabled} onChange={(e) => setTts({ ...tts, enabled: e.target.checked })} />
              Озвучка включена
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={tts.autoFallback} onChange={(e) => setTts({ ...tts, autoFallback: e.target.checked })} />
              Авто-фолбэк
            </label>
          </div>
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
                    silero_judge: tts.sileroJudge,
                    enabled: tts.enabled,
                    auto_fallback: tts.autoFallback,
                    ...(tts.piperBinary ? { piper_binary: tts.piperBinary } : {}),
                    ...(tts.modelPath ? { model_path: tts.modelPath } : {}),
                    ...(tts.configPath ? { config_path: tts.configPath } : {}),
                    speaker_id: Number(tts.speakerId) || 0,
                    speed: Number(tts.speed) || 1.15,
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
          <SecretField label="Moderator ID (пусто = как broadcaster)" value={twitch.moderatorId} onChange={(v) => setTwitch({ ...twitch, moderatorId: v })} />
          <SecretField label={`DonationAlerts токен${twitchHas.donationalerts_token ? ' ● задан' : ''}`} value={twitch.daToken} onChange={(v) => setTwitch({ ...twitch, daToken: v })} />
          <SecretField label={`DonatePay ключ${twitchHas.donatepay_key ? ' ● задан' : ''}`} value={twitch.dpKey} onChange={(v) => setTwitch({ ...twitch, dpKey: v })} />
          <div className="flex flex-wrap gap-3 text-xs text-zinc-300">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={twitch.daEnabled} onChange={(e) => setTwitch({ ...twitch, daEnabled: e.target.checked })} />
              DonationAlerts
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={twitch.dpEnabled} onChange={(e) => setTwitch({ ...twitch, dpEnabled: e.target.checked })} />
              DonatePay
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={twitch.bitsEnabled} onChange={(e) => setTwitch({ ...twitch, bitsEnabled: e.target.checked })} />
              Twitch Bits
            </label>
          </div>
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
                    ...(twitch.moderatorId ? { moderator_id: twitch.moderatorId } : {}),
                    ...(twitch.daToken ? { donationalerts_token: twitch.daToken } : {}),
                    ...(twitch.dpKey ? { donatepay_key: twitch.dpKey } : {}),
                    donationalerts_enabled: twitch.daEnabled,
                    donatepay_enabled: twitch.dpEnabled,
                    twitch_bits_enabled: twitch.bitsEnabled,
                  }).then((r) => {
                    if (r.ok) setTwitch((t) => ({ ...t, token: '', clientId: '', broadcasterId: '', moderatorId: '', daToken: '', dpKey: '' }))
                    return r
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
          <h2 className="font-semibold">Фото судьи для оверлея</h2>
          <p className="text-xs text-zinc-500">Одно фото на весь трибунал. Подпрыгивает, пока судья говорит.</p>
          <label className="block cursor-pointer text-center text-xs text-zinc-400">
            <img
              src={`/api/judge/photo?t=${photoTick}`}
              alt="Судья"
              className="mx-auto mb-1 aspect-square w-40 rounded-lg border border-white/10 bg-black/40 object-cover"
              onError={(e) => {
                ;(e.target as HTMLImageElement).style.opacity = '0.25'
              }}
              onLoad={(e) => {
                ;(e.target as HTMLImageElement).style.opacity = '1'
              }}
            />
            Нажми, чтобы заменить
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void uploadPhoto(e.target.files?.[0])}
            />
          </label>
        </section>

        <section className="card space-y-2 p-4">
          <h2 className="font-semibold">Фон зала суда</h2>
          <img
            src={`/api/court/photo?t=${courtTick}`}
            alt="Фон суда"
            className="aspect-video w-full rounded-lg border border-white/10 bg-black/40 object-cover"
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.opacity = '0.25'
            }}
            onLoad={(e) => {
              ;(e.target as HTMLImageElement).style.opacity = '1'
            }}
          />
          <div className="flex gap-1.5">
            <label className="pressable cursor-pointer rounded-lg border border-white/10 px-3 py-1.5 text-sm">
              Заменить
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  const form = new FormData()
                  form.append('photo', file)
                  if (await apiUpload('/api/court/photo', form)) {
                    toast.success('Фон суда обновлён')
                    setCourtTick((n) => n + 1)
                  } else {
                    toast.error('Загрузка не удалась — проверь секретный ключ')
                  }
                }}
              />
            </label>
            <button
              onClick={async () => {
                const res = await apiFetch('/api/court/photo', { method: 'DELETE' })
                if (res.ok) {
                  toast.success('Вернули стандартный фон')
                  setCourtTick((n) => n + 1)
                } else {
                  toast.error('Не вышло — проверь секретный ключ')
                }
              }}
              className="pressable rounded-lg border border-white/10 px-3 py-1.5 text-sm"
            >
              Стандартный
            </button>
          </div>
        </section>

        <section className="card space-y-2 p-4">
          <h2 className="font-semibold">Безопасность</h2>
          <label className="flex items-center gap-1.5 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={safety.filterEnabled}
              onChange={(e) => setSafety({ ...safety, filterEnabled: e.target.checked })}
            />
            Фильтр токсичности в суде
          </label>
          <label className={labelCls}>
            Чёрный список (по строке)
            <textarea
              value={safety.blacklist} onChange={(e) => setSafety({ ...safety, blacklist: e.target.value })}
              rows={3}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-sm text-white outline-none"
            />
          </label>
          <label className={labelCls}>
            Хоткей паники
            <select
              value={safety.panicHotkey}
              onChange={(e) => setSafety({ ...safety, panicHotkey: e.target.value })}
              className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2 text-sm text-white"
            >
              <option value="escape">Escape</option>
              <option value="f9">F9</option>
              <option value="f12">F12</option>
              <option value="p">P</option>
            </select>
          </label>
          <div>
            <button
              onClick={() =>
                saveSection('Безопасность', () =>
                  apiPut('/api/safety', {
                    filter_enabled: safety.filterEnabled,
                    custom_blacklist: lines(safety.blacklist),
                    panic_hotkey: safety.panicHotkey,
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
          <h2 className="font-semibold">Стример</h2>
          <label className={labelCls}>
            Имя стримера (подсудимый по донатам и !sue)
            <input value={streamerName} onChange={(e) => setStreamerName(e.target.value)} className={inputCls} />
          </label>
          <div>
            <button
              onClick={() =>
                saveSection('Стример', () => apiPut('/api/game', { streamer_name: streamerName }))
              }
              className="pressable rounded-lg bg-amber-400/90 px-4 py-1.5 text-sm font-bold text-black"
            >
              Сохранить
            </button>
          </div>
        </section>

        <section className="card space-y-2 p-4">
          <h2 className="font-semibold">Сервер</h2>
          <p className="tabular font-mono text-sm text-zinc-300">
            {server.host || '—'}:{server.port || '—'} · секрет {server.secretSet ? 'задан' : 'не задан'}
          </p>
          <p className="text-xs text-zinc-500">
            Смена host/port/secret — только через config.yaml, нужен рестарт.
          </p>
          <div>
            <button
              onClick={async () => {
                if (!window.confirm('Перезапустить сервер? Пульт отключится на несколько секунд. Без процесс-менеджера сервер не поднимется сам!')) return
                const r = await apiPost('/api/restart', {})
                if (r.ok) toast.success('Сервер перезапускается… обнови страницу через 5 секунд')
                else toast.error(`Не вышло: ${apiNote(r.status)}`)
              }}
              className="pressable rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-1.5 text-sm"
            >
              Перезапустить сервер
            </button>
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
                <audio controls preload="none" src={`/overlay/sfx/${encodeURIComponent(f.name)}`} className="h-7 w-44" />
              </div>
            ))}
            {sfx.length === 0 && <p className="text-xs text-zinc-600">Сэмплов нет.</p>}
          </div>
        </section>
      </div>
    </div>
  )
}
