import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { apiGet, apiPut } from '../lib/api'
import { getSecret, setSecret } from '../lib/api'
import { HelpTip } from '../components/HelpTip'
import { SecretField } from '../components/SecretField'
import { roundTemp, inputCls, labelCls, saveSection, SaveButton, type AiState, type TtsState, type TwitchState, type ProfileState, type SafetyState, type VoiceLists, type RoleVoice } from './settings/shared'
import { AiSection } from './settings/AiSection'
import { TtsSection } from './settings/TtsSection'
import { IntegrationsSection } from './settings/IntegrationsSection'
import { ProfileSection } from './settings/ProfileSection'
import { DonationRulesSection } from './settings/DonationRulesSection'
import { ShowRulesSection } from './settings/ShowRulesSection'
import { SetupFold } from './settings/SetupFold'
import { SetupGuide, sectionMeta } from './settings/SetupGuide'
import { AppearanceSection } from './settings/AppearanceSection'
import { SafetySection } from './settings/SafetySection'
import { PromptsSection, emptyPrompts, type PromptsState } from './settings/PromptsSection'

export function SettingsView() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('section') || 'guide'
  const legacy: Record<string,[string,string]> = {voice:['connections','voice'],ai:['connections','model'],twitch:['connections','services'],donations:['rules','donations'],safety:['rules','safety'],people:['advanced','profile'],prompts:['advanced','prompts'],server:['advanced','server']}
  const section = legacy[requested]?.[0] || (['guide','appearance','connections','rules','advanced'].includes(requested)?requested:'guide')
  const panel = searchParams.get('panel') ?? legacy[requested]?.[1] ?? ({connections:'',rules:'',advanced:''} as Record<string,string>)[section] ?? ''
  const openPanels = new Set(panel.split(',').filter(Boolean))
  const togglePanel = (next: string) => {
    const selected = new Set(openPanels)
    selected.has(next) ? selected.delete(next) : selected.add(next)
    setSearchParams({section,panel:[...selected].join(',')})
  }
  const groupPanels: Record<string,string[]> = {connections:['model','voice','services'],rules:['show','donations','safety'],advanced:['profile','prompts','server']}
  const allOpen = groupPanels[section]?.every(key=>openPanels.has(key)) ?? false
  const [secret, setSecretLocal] = useState(getSecret())

  const [ai, setAi] = useState<AiState>({ provider: 'groq', model: '', temperature: 0.85, baseUrl: '', extraBody: '' })
  const [apiKey, setApiKey] = useState('')
  const [aiFlags, setAiFlags] = useState<{ has_key: boolean; live: boolean; has_extra_body?: boolean } | null>(null)

  const [tts, setTts] = useState<TtsState>({
    roles: {}, delivery: 'natural',
    elevenKey: '', elevenHasKey: false, elevenVoiceId: '', elevenModelId: 'eleven_multilingual_v2',
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
          roles: Record<string, RoleVoice>; delivery: string
          eleven_has_key: boolean; eleven_voice_id: string; eleven_model_id: string
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
          roles: d.roles || {}, delivery: d.delivery || 'natural',
          elevenHasKey: d.eleven_has_key, elevenVoiceId: d.eleven_voice_id ?? '', elevenModelId: d.eleven_model_id || 'eleven_multilingual_v2',
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
      <div className="desk-heading"><div><p className="eyebrow">Параметры шоу</p><h1>Настройки</h1></div><Link to="/" className="quiet-link">Вернуться в эфир</Link></div>
      <div className="setup-shell">
      <aside className="setup-sidebar"><nav aria-label="Разделы настроек">
        {[['guide','Перед эфиром','Короткий маршрут запуска'],['appearance','Оформление','Тема, зал и персонажи'],['connections','Звук и подключения','Голоса, модель и сервисы'],['rules','Правила шоу','Этапы, донаты и наказания'],['advanced','Дополнительно','Память и тонкая настройка']].map(([key,title,note]) => <button key={key} aria-current={section===key?'page':undefined} onClick={() => setSearchParams({section:key})}><span>{title}</span><small>{note}</small></button>)}
      </nav><div className="sidebar-status"><span className="connection-dot is-connected"/><span>Перед эфиром<small>Модель → голос → сцена OBS</small></span></div></aside>
      <div className="setup-main">
      {section === 'guide' && <SetupGuide />}
      {section !== 'guide' && <div className="section-intro"><p className="eyebrow">{sectionMeta[section]?.[0] || 'Настройки шоу'}</p><h2>{sectionMeta[section]?.[1] || 'Подготовка'}</h2><p>{section === 'appearance' ? sectionMeta[section]?.[2] : ''}</p></div>}
      {groupPanels[section] && <div className="settings-disclosure-bar"><span>Параметры раздела <HelpTip label="Настройка раздела">Откройте нужные блоки или разверните все. Сворачивание сохраняет введённые значения. Применение — кнопкой сохранения внутри блока.</HelpTip></span><button type="button" className="quiet-link" onClick={()=>setSearchParams({section,panel:allOpen?'':groupPanels[section].join(',')})}>{allOpen?'Свернуть все':'Раскрыть все'}</button></div>}
      <div className="setup-content">
        {section === 'appearance' && <AppearanceSection />}
        {section === 'connections' && <div className="setup-folds">
          <SetupFold title="Модель, которая пишет реплики" note={aiFlags?.live?'Параметры заданы · здесь можно проверить ответ':'Нужна для настоящего заседания; репетиция работает без неё'} open={openPanels.has('model')} onToggle={()=>togglePanel('model')}><AiSection ai={ai} setAi={setAi} apiKey={apiKey} setApiKey={setApiKey} flags={aiFlags} onSaved={setAiFlags} /></SetupFold>
          <SetupFold title="Голоса участников" note="Источник речи, тембры трёх ролей и прослушивание" open={openPanels.has('voice')} onToggle={()=>togglePanel('voice')}><TtsSection tts={tts} setTts={setTts} voices={voices} /></SetupFold>
          <SetupFold title="Twitch и донат-сервисы" note="Канал, бот, DonationAlerts и DonatePay — все ключи в одном месте" open={openPanels.has('services')} onToggle={()=>togglePanel('services')}><IntegrationsSection twitch={twitch} setTwitch={setTwitch} has={twitchHas} onSaved={setTwitchHas} /></SetupFold>
        </div>}
        {section === 'rules' && <div className="setup-folds">
          <SetupFold title="Ход заседания" note="Время этапов, очередь зрителей и игровые задания" open={openPanels.has('show')} onToggle={()=>togglePanel('show')}><ShowRulesSection /></SetupFold>
          <SetupFold title="Что дают донаты" note="Показания, взятки, приоритетная очередь и проверка правил" open={openPanels.has('donations')} onToggle={()=>togglePanel('donations')}><DonationRulesSection /></SetupFold>
          <SetupFold title="Контроль эфира" note="Замена слов, ручные наказания и клавиша остановки" open={openPanels.has('safety')} onToggle={()=>togglePanel('safety')}><SafetySection safety={safety} setSafety={setSafety} /></SetupFold>
        </div>}
        {section === 'advanced' && <div className="setup-folds">
          <SetupFold title="Характер и память" note="Имя стримера, привычки и контекст для реплик" open={openPanels.has('profile')} onToggle={()=>togglePanel('profile')}>
            <ProfileSection profile={profile} setProfile={setProfile} />
            <section className="settings-panel"><h2>Имя в делах</h2><label className={labelCls}>Как называть стримера при !sue и суде по донату<input value={streamerName} onChange={event=>setStreamerName(event.target.value)} className={inputCls} /></label><SaveButton onSave={()=>saveSection('Имя стримера',()=>apiPut('/api/game',{streamer_name:streamerName}))} /></section>
          </SetupFold>
          <SetupFold title="Инструкции модели" note="Редактор промптов; для первого эфира можно оставить как есть" open={openPanels.has('prompts')} onToggle={()=>togglePanel('prompts')}><PromptsSection prompts={prompts} setPrompts={setPrompts} onReset={()=>setPromptsTick(n=>n+1)} /></SetupFold>
          <SetupFold title="Сервер и доступ" note="Адрес локального сервера и ключ управления" open={openPanels.has('server')} onToggle={()=>togglePanel('server')}>
            <section className="settings-panel"><h2>Доступ к управлению</h2><p>Этот ключ нужен только если на сервере задан секрет. Это не ключ языковой модели или ElevenLabs.</p><SecretField label="Ключ управления приложением" value={secret} onChange={setSecretLocal} onCommit={value=>{if(value===getSecret())return;setSecretLocal(value);setSecret(value);location.reload()}} /></section>
            <section className="settings-panel"><h2>Локальный сервер</h2><p>{server.host||'—'}:{server.port||'—'} · ключ доступа {server.secretSet?'задан':'не задан'}</p><p>Параметры host, port и secret задаются в config.yaml. После изменения остановите dev.sh клавишами Ctrl+C и запустите снова.</p><pre className="setup-command">./dev.sh</pre></section>
          </SetupFold>
        </div>}
      </div>
      </div></div>
    </div>
  )
}
