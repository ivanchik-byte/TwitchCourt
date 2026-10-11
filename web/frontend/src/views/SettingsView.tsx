import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { apiGet, apiPut, apiPost, apiUpload, apiFetch, apiNote } from '../lib/api'
import { getSecret, setSecret } from '../lib/api'
import { SecretField } from '../components/SecretField'
import { roundTemp, inputCls, labelCls, saveSection, SaveButton, type AiState, type TtsState, type TwitchState, type ProfileState, type SafetyState, type VoiceLists } from './settings/shared'
import { AiSection } from './settings/AiSection'
import { TtsSection } from './settings/TtsSection'
import { IntegrationsSection } from './settings/IntegrationsSection'
import { ProfileSection } from './settings/ProfileSection'
import { SafetySection } from './settings/SafetySection'
import { PromptsSection, emptyPrompts, type PromptsState } from './settings/PromptsSection'

export function SettingsView() {
  const [secret, setSecretLocal] = useState(getSecret())

  const [ai, setAi] = useState<AiState>({ provider: 'groq', model: '', temperature: 0.85, baseUrl: '', extraBody: '' })
  const [apiKey, setApiKey] = useState('')
  const [aiFlags, setAiFlags] = useState<{ has_key: boolean; live: boolean; has_extra_body?: boolean } | null>(null)

  const [tts, setTts] = useState<TtsState>({
    engine: 'edge',
    voice: 'ru-RU-SvetlanaNeural',
    customVoice: '',
    sileroJudge: 'kseniya',
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

  const [twitch, setTwitch] = useState<TwitchState>({
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

  const [profile, setProfile] = useState<ProfileState>({
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
  const [safety, setSafety] = useState<SafetyState>({ filterEnabled: true, blacklist: '', panicHotkey: 'escape', banConfirm: false })
  const [prompts, setPrompts] = useState<PromptsState>(emptyPrompts)
  const [promptsTick, setPromptsTick] = useState(0)
  const [streamerName, setStreamerName] = useState('')
  const [server, setServer] = useState({ host: '', port: 0, secretSet: false })

  useEffect(() => {
    const load = async () => {
      const settled = await Promise.allSettled([
        apiGet<{ provider: string; model: string; temperature: number; base_url: string; has_key: boolean; live: boolean; has_extra_body: boolean }>('/api/ai'),
        apiGet<{
          engine: string; voice: string; rate: string; volume: string; pitch: string
          judge_voice: string; judge_rate: string; silero_url: string; silero_judge: string
          enabled: boolean; auto_fallback: boolean; piper_binary: string; model_path: string
          config_path: string; speaker_id: number; speed: number; beep?: boolean
          voices?: { edge?: string[]; silero?: string[] }
        }>('/api/tts'),
        apiGet<Record<string, string | boolean>>('/api/integrations'),
        apiGet<{ name: string; titles: string[]; traits: string[]; running_gags: string[]; mercy: string; auto_notes: string[] }>('/api/profile'),
        apiGet<{ sfx: { name: string; size: number }[] }>('/api/sfx'),
        apiGet<{ filter_enabled: boolean; custom_blacklist: string[]; panic_hotkey: string; ban_confirm: boolean }>('/api/safety'),
        apiGet<{ streamer_name: string }>('/api/game'),
        apiGet<{ host: string; port: number; secret_set: boolean }>('/api/server'),
        apiGet<{
          judge_strict: string; judge_cynical: string; prosecutor: string; prosody: string
          task_indictment: string; task_counter: string; task_deliberation: string
          bribe_note: string; condemn_note: string; gen_prompt: string; confession: string
        }>('/api/prompts'),
      ])
      const [aiR, ttsR, intR, profR, sfxR, safR, gameR, srvR, prmR] = settled

      if (aiR.status === 'fulfilled') {
        const d = aiR.value
        setAi({
          provider: d.provider,
          model: d.model ?? '',
          temperature: roundTemp(d.temperature ?? 0.85),
          baseUrl: d.base_url ?? '',
          extraBody: '',
        })
        setAiFlags({ has_key: d.has_key, live: d.live, has_extra_body: d.has_extra_body })
      }
      if (ttsR.status === 'fulfilled') {
        const d = ttsR.value
        const edge = Array.isArray(d.voices?.edge) ? d.voices.edge : []
        const silero = Array.isArray(d.voices?.silero) ? d.voices.silero : []
        setVoices({ edge, silero })
        setTts((t) => ({
          ...t,
          engine: d.engine,
          voice: edge.includes(d.voice) ? d.voice : 'custom',
          customVoice: edge.includes(d.voice) ? '' : (d.voice ?? ''),
          sileroJudge: silero.includes(d.silero_judge) ? d.silero_judge : (d.silero_judge || 'kseniya'),
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
      }
      if (intR.status === 'fulfilled') {
        const d = intR.value
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
      }
      if (profR.status === 'fulfilled') {
        const d = profR.value
        setProfile({
          name: d.name ?? '',
          mercy: d.mercy ?? '',
          titles: (d.titles ?? []).join('\n'),
          traits: (d.traits ?? []).join('\n'),
          gags: (d.running_gags ?? []).join('\n'),
          notes: (d.auto_notes ?? []).join('\n'),
        })
      }
      if (sfxR.status === 'fulfilled') setSfx(sfxR.value.sfx ?? [])
      if (safR.status === 'fulfilled') {
        const d = safR.value
        setSafety({
          filterEnabled: d.filter_enabled !== false,
          blacklist: (d.custom_blacklist ?? []).join('\n'),
          panicHotkey: d.panic_hotkey || 'escape',
          banConfirm: d.ban_confirm === true,
        })
      }
      if (gameR.status === 'fulfilled') setStreamerName(gameR.value.streamer_name ?? '')
      if (srvR.status === 'fulfilled') {
        const d = srvR.value
        setServer({ host: d.host ?? '', port: d.port ?? 0, secretSet: !!d.secret_set })
      }
      if (prmR.status === 'fulfilled') {
        const d = prmR.value
        setPrompts({
          judgeStrict: d.judge_strict ?? '',
          judgeCynical: d.judge_cynical ?? '',
          prosecutor: d.prosecutor ?? '',
          prosody: d.prosody ?? '',
          taskIndictment: d.task_indictment ?? '',
          taskCounter: d.task_counter ?? '',
          taskDeliberation: d.task_deliberation ?? '',
          bribeNote: d.bribe_note ?? '',
          condemnNote: d.condemn_note ?? '',
          confession: d.confession ?? '',
          genPrompt: d.gen_prompt ?? '',
        })
      }
    }
    void load()
  }, [promptsTick])

  const uploadPhoto = async (file: File | undefined) => {
    if (!file) return
    const form = new FormData()
    form.append('photo', file)
    const ok = await apiUpload('/api/judge/photo', form)
    if (ok) {
      toast.success('Фото судьи обновлено')
      setPhotoTick((n) => n + 1)
    } else {
      toast.error('Ошибка загрузки: проверьте ключ доступа')
    }
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-3 p-3">
      <div className="card p-3">
        <div className="min-w-[220px] max-w-prose">
          <SecretField label="Ключ доступа к API" value={secret} onChange={setSecretLocal} onCommit={(v) => { setSecretLocal(v); setSecret(v); location.reload() }} placeholder="X-Secret" />
        </div>
      </div>

      <div className="grid items-start gap-3 md:grid-cols-2">
        <AiSection ai={ai} setAi={setAi} apiKey={apiKey} setApiKey={setApiKey} flags={aiFlags} />
        <TtsSection tts={tts} setTts={setTts} voices={voices} />
        <IntegrationsSection twitch={twitch} setTwitch={setTwitch} has={twitchHas} />
        <ProfileSection profile={profile} setProfile={setProfile} />

        <section className="card space-y-2 p-4">
          <h2 className="font-semibold">Фото судьи для оверлея</h2>
          <p className="text-xs text-zinc-500">Портрет отображается на оверлее во время речи судьи.</p>
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
            Нажмите для выбора файла
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
                    toast.error('Ошибка загрузки: проверьте ключ доступа')
                  }
                }}
              />
            </label>
            <button
              onClick={async () => {
                const res = await apiFetch('/api/court/photo', { method: 'DELETE' })
                if (res.ok) {
                  toast.success('Установлен стандартный фон')
                  setCourtTick((n) => n + 1)
                } else {
                  toast.error('Ошибка сброса: проверьте ключ доступа')
                }
              }}
              className="pressable rounded-lg border border-white/10 px-3 py-1.5 text-sm"
            >
              Стандартный
            </button>
          </div>
        </section>

        <SafetySection safety={safety} setSafety={setSafety} />

        <PromptsSection prompts={prompts} setPrompts={setPrompts} onReset={() => setPromptsTick((n) => n + 1)} />

        <section className="card space-y-2 p-4">
          <h2 className="font-semibold">Стример</h2>
          <label className={labelCls}>
            Имя стримера (подсудимый по донатам и !sue)
            <input value={streamerName} onChange={(e) => setStreamerName(e.target.value)} className={inputCls} />
          </label>
          <div>
            <SaveButton
              onSave={() =>
                saveSection('Стример', () => apiPut('/api/game', { streamer_name: streamerName }))
              }
            />
          </div>
        </section>

        <section className="card space-y-2 p-4">
          <h2 className="font-semibold">Сервер</h2>
          <p className="tabular font-mono text-sm text-zinc-300">
            {server.host || '-'}:{server.port || '-'} · ключ доступа {server.secretSet ? 'задан' : 'не задан'}
          </p>
          <p className="text-xs text-zinc-500">
            Параметры host, port и secret настраиваются в config.yaml и требуют перезапуска.
          </p>
          <div>
            <button
              onClick={async () => {
                if (!window.confirm('Перезапустить сервер? Панель управления временно потеряет связь.')) return
                const r = await apiPost('/api/restart', {})
                if (r.ok) toast.success('Сервер перезапускается. Обновите страницу через несколько секунд.')
                else toast.error(`Ошибка перезапуска: ${apiNote(r.status)}`)
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
            <iframe title="overlay preview" src={`/overlay/${secret ? `?secret=${encodeURIComponent(secret)}` : ''}`} className="h-48 w-full bg-black" />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(`${location.origin}/overlay/`)
                toast.success('URL оверлея скопирован (без ключа)')
              }}
              className="pressable rounded-lg border border-white/10 px-3 py-1.5 text-sm"
            >
              Скопировать URL для OBS
            </button>
            {secret && (
              <button
                onClick={() => {
                  void navigator.clipboard?.writeText(`${location.origin}/overlay/?secret=${encodeURIComponent(secret)}`)
                  toast.success('URL с ключом скопирован — не свети его на стриме')
                }}
                className="pressable rounded-lg border border-amber-400/30 px-3 py-1.5 text-sm text-amber-200"
              >
                URL с ключом — один раз
              </button>
            )}
          </div>
          <div className="space-y-1">
            {sfx.map((f) => (
              <div key={f.name} className="flex items-center gap-2 text-xs text-zinc-400">
                <span className="flex-1 truncate font-mono">{f.name}</span>
                <audio controls preload="none" src={`/overlay/sfx/${encodeURIComponent(f.name)}`} className="h-7 w-44" />
              </div>
            ))}
            {sfx.length === 0 && <p className="text-xs text-zinc-600">Звуковые эффекты не найдены.</p>}
          </div>
        </section>
      </div>
    </div>
  )
}
