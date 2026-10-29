import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { apiGet, apiPut, apiPost, apiNote } from '../lib/api'
import { getSecret, setSecret } from '../lib/api'
import { SecretField } from '../components/SecretField'
import { roundTemp, inputCls, labelCls, saveSection, SaveButton, type AiState, type TtsState, type TwitchState, type ProfileState, type SafetyState, type VoiceLists } from './settings/shared'
import { AiSection } from './settings/AiSection'
import { TtsSection } from './settings/TtsSection'
import { IntegrationsSection } from './settings/IntegrationsSection'
import { ProfileSection } from './settings/ProfileSection'
import { DonationRulesSection } from './settings/DonationRulesSection'
import { ShowRulesSection } from './settings/ShowRulesSection'
import { AppearanceSection } from './settings/AppearanceSection'
import { SafetySection } from './settings/SafetySection'
import { PromptsSection, emptyPrompts, type PromptsState } from './settings/PromptsSection'

export function SettingsView() {
  const [searchParams, setSearchParams] = useSearchParams()
  const section = searchParams.get('section') || 'ai'
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
        apiGet<{ filter_enabled: boolean; custom_blacklist: string[]; panic_hotkey: string; ban_confirm: boolean }>('/api/safety'),
        apiGet<{ streamer_name: string }>('/api/game'),
        apiGet<{ host: string; port: number; secret_set: boolean }>('/api/server'),
        apiGet<{
          judge_strict: string; judge_cynical: string; prosecutor: string; prosody: string
          task_indictment: string; task_counter: string; task_deliberation: string
          bribe_note: string; condemn_note: string; gen_prompt: string; confession: string
        }>('/api/prompts'),
      ])
      const [aiR, ttsR, intR, profR, safR, gameR, srvR, prmR] = settled

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
          clientId: String(d.client_id ?? ''),
          broadcasterId: String(d.broadcaster_id ?? ''),
          moderatorId: String(d.moderator_id ?? ''),
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

  return (
    <div className="setup-page">
      <div className="desk-heading"><div><p className="eyebrow">Параметры шоу</p><h1>Подготовка</h1></div><Link to="/" className="quiet-link">Вернуться в эфир</Link></div>
      <nav className="setup-tabs" aria-label="Разделы подготовки">
        {[['ai', '01', 'Языковая модель'], ['voice', '02', 'Голос судьи'], ['twitch', '03', 'Подключения'], ['donations', '04', 'Донаты'], ['rules', '05', 'Правила суда'], ['appearance', '06', 'Оформление'], ['advanced', '07', 'Дополнительно']].map(([key, number, label]) => <button key={key} aria-current={section === key ? 'page' : undefined} onClick={() => setSearchParams({ section: key })}><span>{number}</span>{label}</button>)}
      </nav>
      <details className="access-settings">
        <summary>Доступ к управлению</summary>
        <p>Нужен только если на сервере задан секретный ключ.</p>
        <SecretField label="Ключ доступа к API" value={secret} onChange={setSecretLocal} onCommit={(v) => { if (v === getSecret()) return; setSecretLocal(v); setSecret(v); location.reload() }} placeholder="X-Secret" />
      </details>

      <div className="setup-content">
        {section === 'donations' && <DonationRulesSection />}
        {section === 'rules' && <ShowRulesSection />}
        {section === 'ai' && <AiSection ai={ai} setAi={setAi} apiKey={apiKey} setApiKey={setApiKey} flags={aiFlags} />}
        {section === 'voice' && <TtsSection tts={tts} setTts={setTts} voices={voices} />}
        {section === 'twitch' && <IntegrationsSection twitch={twitch} setTwitch={setTwitch} has={twitchHas} />}
        {section === 'advanced' && <ProfileSection profile={profile} setProfile={setProfile} />}

        {section === 'appearance' && <AppearanceSection />}

        {section === 'advanced' && <SafetySection safety={safety} setSafety={setSafety} />}

        {section === 'advanced' && <PromptsSection prompts={prompts} setPrompts={setPrompts} onReset={() => setPromptsTick((n) => n + 1)} />}

        {section === 'advanced' && <section className="card space-y-2 p-4">
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
        </section>}

        {section === 'advanced' && <section className="card space-y-2 p-4">
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
        </section>}


      </div>
    </div>
  )
}
