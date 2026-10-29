import { memo, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { apiFetch, apiGet } from '../../lib/api'
import { SecretField } from '../../components/SecretField'
import { RoleVoices } from './RoleVoices'
import { HelpTip } from '../../components/HelpTip'
import { inputCls, labelCls, type TtsState, type VoiceLists } from './shared'

interface Props { tts: TtsState; setTts: (v: TtsState) => void; voices: VoiceLists }
interface LocalVoice { status: 'stopped' | 'loading' | 'ready' | 'error'; voices: string[] }
const speakerNames: Record<string, string> = { kseniya: 'Ксения', xenia: 'Ксения · другой тембр', baya: 'Бая', aidar: 'Айдар', eugene: 'Евгений' }
const descriptions: Record<string, string> = {
  edge: 'Готовые русские голоса через интернет. Ключ и установка не нужны.',
  silero: 'Русская речь на вашем компьютере. После установки и загрузки модели работает без интернета.',
  piper: 'Локальный голос из файла. Нужны установленный Piper и модель выбранного диктора.',
  elevenlabs: 'Облачная озвучка вашим голосом из ElevenLabs. Нужны ключ и Voice ID; запросы расходуют квоту аккаунта.',
  mock: 'Короткий сигнал вместо речи. Проверяет, доходит ли звук до браузера и OBS; модель и интернет не нужны.',
}

function PiperFiles({ tts, setTts }: Pick<Props, 'tts' | 'setTts'>) {
  return <div className="piper-files">
        <button type="button" className="secondary-action" onClick={() => setTts({ ...tts, piperBinary: navigator.userAgent.includes('Windows') ? '.venv-tts/Scripts/piper.exe' : '.venv-tts/bin/piper', modelPath: 'models/ru_RU-irina-medium.onnx', configPath: 'models/ru_RU-irina-medium.onnx.json' })}>Подставить стандартные пути</button>
        <label>Исполняемый файл Piper <HelpTip label="Путь к Piper">Путь на компьютере с сервером приложения. После подготовки через voice.sh это .venv-tts/bin/piper. Можно указать установленную команду piper из PATH.</HelpTip><input value={tts.piperBinary} onChange={event => setTts({ ...tts, piperBinary: event.target.value })} /></label>
        <label>Файл голоса · .onnx<input value={tts.modelPath} onChange={event => setTts({ ...tts, modelPath: event.target.value })} /></label>
        <label>Параметры голоса · .onnx.json<input value={tts.configPath} onChange={event => setTts({ ...tts, configPath: event.target.value })} /></label>
        <div className="voice-two-fields"><label>Номер диктора <HelpTip label="Номер диктора">В модели с одним голосом оставьте 0. Другой номер нужен только для модели с несколькими дикторами.</HelpTip><input type="number" min="0" value={tts.speakerId} onChange={event => setTts({ ...tts, speakerId: event.target.value })} /></label><label>Скорость <HelpTip label="Скорость Piper">1 — обычная, 1.15 — немного быстрее, 0.9 — медленнее.</HelpTip><input type="number" min="0.1" max="3" step="0.05" value={tts.speed} onChange={event => setTts({ ...tts, speed: event.target.value })} /></label></div>
  </div>
}

export const TtsSection = memo(function TtsSection({ tts, setTts, voices }: Props) {
  const [previewRole,setPreviewRole] = useState('judge')
  const [previewUrl, setPreviewUrl] = useState('')
  const [error, setError] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [starting, setStarting] = useState(false)
  const [local, setLocal] = useState<LocalVoice | null>(null)
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])
  useEffect(() => {
    if (tts.engine !== 'silero') return
    let active = true
    const check = () => { void apiGet<LocalVoice>('/api/tts/local').then(state => { if (active) setLocal(state) }).catch(() => { if (active) setLocal(null) }) }
    check()
    const timer = setInterval(check, 3000)
    return () => { active = false; clearInterval(timer) }
  }, [tts.engine])
  const effectiveVoice = tts.voice === 'custom' ? tts.customVoice : tts.voice
  const sileroVoices = local?.voices?.length ? local.voices : voices.silero
  const settings = () => ({
    roles: tts.roles, delivery: tts.delivery,
    engine: tts.engine, voice: effectiveVoice, rate: tts.rate, volume: tts.volume, pitch: tts.pitch,
    judge_voice: tts.judgeVoice, judge_rate: tts.judgeRate, silero_url: tts.sileroUrl,
    silero_judge: tts.sileroJudge, enabled: tts.enabled, auto_fallback: tts.autoFallback,
    piper_binary: tts.piperBinary, model_path: tts.modelPath, config_path: tts.configPath,
    speaker_id: Number(tts.speakerId) || 0, speed: Number(tts.speed) || 1,
    eleven_voice_id: tts.elevenVoiceId, eleven_model_id: tts.elevenModelId,
    ...(tts.elevenKey.trim() ? { eleven_api_key: tts.elevenKey.trim() } : {}),
  })
  return <div className="voice-workspace">
    <section className="settings-panel voice-controls">
      <div className="voice-heading"><div><p className="eyebrow">Речь в заседании</p><h2>Источник озвучки</h2></div><span className="voice-tag">{['silero', 'piper'].includes(tts.engine) ? 'Локально' : tts.engine === 'mock' ? 'Проверка' : 'Через интернет'}</span></div>
      <label className={labelCls}>Источник голоса <HelpTip label="Источник голоса">Этот сервис озвучивает реплики. Текст придумывает языковая модель в отдельном разделе «Модель и ключ».</HelpTip>
        <select disabled={previewing || saving || starting} value={tts.engine} onChange={event => { setError(''); setPreviewUrl(''); setTts({ ...tts, engine: event.target.value }) }}>
          <option value="edge">Edge · без ключа</option><option value="silero">Silero · локальная речь</option><option value="piper">Piper · голос из файла</option><option value="elevenlabs">ElevenLabs · API</option><option value="mock">Проверка звука · без речи</option>
        </select>
      </label>
      <p className="voice-description">{descriptions[tts.engine]}</p>
      {tts.engine === 'edge' && <>
        <label className={labelCls}>Основной тембр<select value={tts.voice} onChange={event => setTts({ ...tts, voice: event.target.value, judgeVoice: event.target.value === 'custom' ? '' : event.target.value })}>
          {(voices.edge.length ? voices.edge : ['ru-RU-SvetlanaNeural', 'ru-RU-DmitryNeural']).map(voice => <option key={voice} value={voice}>{voice === 'ru-RU-SvetlanaNeural' ? 'Светлана · русский' : voice === 'ru-RU-DmitryNeural' ? 'Дмитрий · русский' : voice}</option>)}<option value="custom">Другой голос…</option>
        </select></label>
        {tts.voice === 'custom' && <label className={labelCls}>Название голоса<input value={tts.customVoice} onChange={event => setTts({ ...tts, customVoice: event.target.value, judgeVoice: event.target.value })} placeholder="ru-RU-SvetlanaNeural" className={inputCls} /></label>}
        <details className="voice-details"><summary>Темп, громкость и тон</summary><div className="voice-three-fields">
          <label>Темп <HelpTip label="Темп">Процент относительно обычной скорости: -10% медленнее, +10% быстрее. Для реплик судьи используется отдельный темп ниже.</HelpTip><input value={tts.rate} onChange={event => setTts({ ...tts, rate: event.target.value })} placeholder="+0%" /></label>
          <label>Громкость<input value={tts.volume} onChange={event => setTts({ ...tts, volume: event.target.value })} placeholder="+0%" /></label>
          <label>Тон<input value={tts.pitch} onChange={event => setTts({ ...tts, pitch: event.target.value })} placeholder="+0Hz" /></label>
        </div></details>

      </>}
      {tts.engine === 'silero' && <>
        <div className="local-voice-status" role="status"><span className={`connection-dot${local?.status === 'ready' ? ' is-connected' : ''}`} /><div><strong>{local?.status === 'ready' ? 'Silero готов' : local?.status === 'loading' ? 'Загружается модель…' : local?.status === 'error' ? 'Не удалось запустить Silero' : local ? 'Локальный голос остановлен' : 'Проверяем локальный голос…'}</strong><small>{local?.status === 'loading' ? 'Первый запуск скачивает модель. Дождитесь готовности.' : local?.status === 'error' ? 'Подготовьте зависимости по инструкции справа. Подробности: data/silero.log.' : 'Сервис на этом компьютере · порт 7892'}</small></div></div>
        <button type="button" className="secondary-action" disabled={starting || local?.status === 'loading' || local?.status === 'ready'} onClick={async () => {
          setStarting(true); setError('')
          try { const response = await apiFetch('/api/tts/local', { method: 'POST' }); if (!response.ok) setError((await response.text()).trim()); else { setLocal(await response.json()); setTts({ ...tts, sileroUrl: 'http://127.0.0.1:7892' }) } }
          catch { setError('Нет связи с сервером приложения.') }
          finally { setStarting(false) }
        }}>{starting ? 'Запускаем…' : local?.status === 'ready' ? 'Сервис работает' : 'Запустить Silero'}</button>
        <label>Диктор<select value={tts.sileroJudge} onChange={event => setTts({ ...tts, sileroJudge: event.target.value })}>
          {sileroVoices.map(voice => <option key={voice} value={voice}>{speakerNames[voice] || voice}</option>)}
          {!sileroVoices.includes(tts.sileroJudge) && <option value={tts.sileroJudge}>{speakerNames[tts.sileroJudge] || tts.sileroJudge}</option>}
        </select></label>
        <details className="voice-details"><summary>Адрес собственного сервиса</summary><p>Кнопка выше запускает только встроенный сервис на 127.0.0.1:7892. Другой сервер нужно запустить самостоятельно.</p><label>Адрес Silero<input value={tts.sileroUrl} onChange={event => setTts({ ...tts, sileroUrl: event.target.value })} placeholder="http://127.0.0.1:7892" /></label></details>
      </>}
      {tts.engine === 'piper' && <>
        <PiperFiles tts={tts} setTts={setTts} />
      </>}
      {tts.engine === 'elevenlabs' && <>
        <SecretField label={`API-ключ ElevenLabs${tts.elevenHasKey ? ' · сохранён' : ''}`} value={tts.elevenKey} onChange={value => setTts({ ...tts, elevenKey: value })} help={<HelpTip label="Ключ ElevenLabs">Создайте ключ в ElevenLabs → Developers → API Keys с разрешением Text to Speech. Пустое поле сохраняет прежний ключ. Ключ передаётся сервису только сервером приложения.</HelpTip>} />
        <label>Voice ID <HelpTip label="Voice ID">Идентификатор голоса, а не его название. Скопируйте ID у выбранного голоса в My Voices в ElevenLabs. Голос должен быть доступен вашему аккаунту.</HelpTip><input value={tts.elevenVoiceId} onChange={event => setTts({ ...tts, elevenVoiceId: event.target.value })} placeholder="ID из My Voices" /></label>
        <label>Модель озвучки<select value={tts.elevenModelId} onChange={event => setTts({ ...tts, elevenModelId: event.target.value })}><option value="eleven_multilingual_v2">Multilingual v2 · многоязычная речь</option><option value="eleven_flash_v2_5">Flash v2.5 · быстрые реплики</option><option value="eleven_v3">Eleven v3 · актёрская подача</option>{!['eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_v3'].includes(tts.elevenModelId) && <option value={tts.elevenModelId}>{tts.elevenModelId}</option>}</select></label>
      </>}
      {tts.engine==='elevenlabs' && <label>Подача <HelpTip label="Подача">Ровнее — меньше случайных колебаний интонации. Выразительнее — больше вариаций, но результат менее предсказуем. Для Eleven v3 используется также короткая интонационная подсказка в тексте синтеза; в субтитры она не попадает.</HelpTip><select value={tts.delivery} onChange={event=>setTts({...tts,delivery:event.target.value})}><option value="restrained">Сдержанно</option><option value="natural">Естественно</option><option value="expressive">Выразительнее</option></select></label>}
      {tts.engine!=='mock' && <RoleVoices tts={tts} setTts={setTts} voices={voices} />}
      <div className="settings-callout voice-realism"><strong>{tts.engine==='elevenlabs'?'Интонация зависит от голоса':'Тембр и эмоции — разные вещи'}</strong><p>{tts.engine==='elevenlabs'?'Для живой подачи попробуйте Eleven v3 и несколько Voice ID. Один и тот же текст может прозвучать по-разному; сначала проверьте короткую реплику каждой роли.':'Silero, Piper и текущий Edge не имеют здесь отдельного управления эмоциями. Разные тембры уже разделяют участников; для актёрской подачи доступен ElevenLabs с отдельными настройками выразительности.'}</p></div>
      <div className="voice-switches">
        <label className="setting-switch"><input type="checkbox" checked={tts.enabled} onChange={event => setTts({ ...tts, enabled: event.target.checked })} />Озвучивать заседание <HelpTip label="Озвучка">Выключает речь во время заседания. Кнопка прослушивания ниже всё равно позволяет проверить выбранный голос.</HelpTip></label>
        {tts.engine !== 'mock' && <label className="setting-switch"><input type="checkbox" checked={tts.autoFallback} onChange={event => setTts({ ...tts, autoFallback: event.target.checked })} />Резервный Piper при сбое <HelpTip label="Резервный голос">Если основной сервис не ответит, приложение попробует Piper с указанными путями. Для резерва тоже нужно установить Piper и скачать голос. Если оба недоступны, речь не прозвучит.</HelpTip></label>}
      </div>
      {tts.autoFallback && !['piper', 'mock'].includes(tts.engine) && <details className="voice-details"><summary>Настроить резервный Piper</summary><p>Для установки выполните <code>./voice.sh piper</code> из папки проекта, затем подставьте пути. Эти параметры сохраняются вместе с основным голосом.</p><PiperFiles tts={tts} setTts={setTts} /></details>}
      <label className="preview-role-choice">Кого прослушать<select value={previewRole} onChange={event=>setPreviewRole(event.target.value)}><option value="judge">Судью</option><option value="prosecutor">Прокурора</option><option value="advocate">Адвоката</option></select></label>
      <div className="voice-actions"><button className="primary-action" disabled={saving || previewing} onClick={async () => {
        setSaving(true); setError('')
        try { const response = await apiFetch('/api/tts', { method: 'PUT', body: JSON.stringify(settings()) }); if (!response.ok) setError(response.status === 409 ? 'Закончите заседание перед сменой голоса.' : 'Не удалось сохранить голос. Проверьте связь и ключ доступа.'); else { const saved = await response.json(); setTts({ ...tts, elevenKey: '', elevenHasKey: saved.eleven_has_key, beep: saved.beep }); toast.success('Голос сохранён. Перезапуск не нужен.') } }
        catch { setError('Нет связи с сервером приложения.') }
        finally { setSaving(false) }
      }}>{saving ? 'Сохраняем…' : 'Сохранить голос'}</button>
      <button className="secondary-action" disabled={previewing || saving} onClick={async () => {
        setPreviewing(true); setError(''); setPreviewUrl('')
        const { enabled: _enabled, auto_fallback: _fallback, judge_voice: _judgeVoice, judge_rate: _judgeRate, silero_judge: _sileroJudge, ...draft } = settings()
        try {
          const response = await apiFetch('/api/tts/preview', { method: 'POST', body: JSON.stringify({ ...draft, role: previewRole, voice: tts.engine === 'silero' ? tts.sileroJudge : tts.judgeVoice || effectiveVoice, rate: tts.engine === 'edge' ? tts.judgeRate || tts.rate : tts.rate }) })
          if (!response.ok) { const note = (await response.text()).trim(); setError(response.status === 401 ? 'Проверьте ключ доступа к приложению.' : response.status === 409 ? 'Закончите заседание перед проверкой голоса.' : note || 'Сервис не вернул звук.') }
          else setPreviewUrl(URL.createObjectURL(await response.blob()))
        } catch { setError('Нет связи с сервером приложения.') }
        finally { setPreviewing(false) }
      }}>{previewing ? 'Готовим реплику…' : tts.engine === 'mock' ? 'Прослушать сигнал' : 'Прослушать роль'}</button></div>
      <p className="voice-footnote">Прослушивание использует выбранные параметры, даже до сохранения. Звук играет только здесь. {tts.engine === 'elevenlabs' && 'Проверка расходует квоту ElevenLabs.'}</p>
      {error && <p className="desk-error" role="alert">{error}</p>}
      {previewUrl && <audio key={previewUrl} controls autoPlay src={previewUrl} aria-label={`Пробная реплика: ${previewRole==='prosecutor'?'прокурор':previewRole==='advocate'?'адвокат':'судья'}`} className="voice-audio" />}
    </section>
    <aside className="voice-guide settings-panel">
      <p className="eyebrow">Как подключить</p><h2>{tts.engine === 'silero' ? 'Silero на вашем ПК' : tts.engine === 'piper' ? 'Голос из файла' : tts.engine === 'elevenlabs' ? 'Ваш голос в ElevenLabs' : tts.engine === 'mock' ? 'Проверить звуковой тракт' : 'Быстрый старт с Edge'}</h2>
      {tts.engine === 'silero' && <><ol><li>Один раз подготовьте зависимости. В терминале, из папки проекта:</li></ol><pre>./voice.sh silero</pre><p>Нужен Python 3 с модулем venv. Команда создаст отдельное окружение и скачает PyTorch для CPU, NumPy и SciPy. Это может занять несколько минут.</p><ol start={2}><li>Нажмите «Запустить Silero». При первом запуске скачается русская модель; следите за состоянием слева.</li><li>Когда появится «Silero готов», выберите диктора и прослушайте судью.</li><li>Сохраните голос. Держать второй терминал открытым не нужно: приложение управляет сервисом.</li></ol><p>Если загрузка не удалась, подробности в <code>data/silero.log</code>. Интернет нужен для установки и первой загрузки модели.</p><a href="https://github.com/snakers4/silero-models" target="_blank" rel="noreferrer">Документация Silero</a></>}
      {tts.engine === 'piper' && <><ol><li>Подготовьте Piper и русский голос Ирины одной командой из папки проекта:</li></ol><pre>./voice.sh piper</pre><ol start={2}><li>Нажмите «Подставить стандартные пути». Скрипт скачивает пару файлов: модель .onnx и её .onnx.json.</li><li>Прослушайте голос и сохраните. Отдельный сервер Piper запускать не нужно.</li></ol><p>При другом голосе замените оба пути на его файлы. Первое слово может готовиться дольше: модель загружается для каждой реплики.</p><a href="https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/CLI.md" target="_blank" rel="noreferrer">Установка и голоса Piper</a></>}
      {['silero', 'piper'].includes(tts.engine) && <details className="voice-details"><summary>Подготовка в Windows из исходников</summary><p>В PowerShell, из папки проекта:</p><pre>{`py -m venv .venv-tts\n${tts.engine === 'silero' ? '.venv-tts\\Scripts\\python -m pip install torch --index-url https://download.pytorch.org/whl/cpu\n.venv-tts\\Scripts\\python -m pip install numpy scipy' : '.venv-tts\\Scripts\\python -m pip install piper-tts\n.venv-tts\\Scripts\\python -m piper.download_voices --data-dir models ru_RU-irina-medium'}`}</pre><p>Затем используйте те же кнопки в панели. Готовые пакеты Windows и Linux пока не собирались.</p></details>}
      {tts.engine === 'elevenlabs' && <><ol><li>Откройте ElevenLabs → Developers → API Keys и создайте ключ с доступом к Text to Speech.</li><li>Добавьте голос в My Voices и скопируйте его Voice ID.</li><li>Вставьте ключ и ID слева, затем прослушайте реплику. Для русского оставьте многоязычную модель.</li><li>Сохраните. Ключ хранится в локальном config.yaml, а панель показывает только факт его наличия.</li></ol><p>При ошибке квоты проверьте баланс аккаунта. Ключ ElevenLabs нужен для речи; ключ языковой модели задаётся отдельно.</p><a href="https://elevenlabs.io/docs/api-reference/text-to-speech/convert" target="_blank" rel="noreferrer">Документация ElevenLabs</a></>}
      {tts.engine === 'edge' && <><ol><li>Оставьте Светлану или выберите Дмитрия.</li><li>Нажмите «Прослушать роль». Звук прозвучит в этом браузере.</li><li>Сохраните голос и проверьте звук в браузерном источнике OBS на учебном деле.</li></ol><p>Edge требует интернета. Если сервис не отвечает, выберите локальный голос; резерв сработает только при установленном Piper.</p></>}
      {tts.engine === 'mock' && <><p>Это прежний Mock, то есть тестовый сигнал. Он не читает текст и не имитирует голос.</p><ol><li>Нажмите «Прослушать сигнал» и проверьте громкость браузера.</li><li>Чтобы проверить OBS, сохраните этот источник звука и запустите учебное дело.</li><li>Перед настоящим заседанием выберите речевой движок.</li></ol></>}
    </aside>
  </div>
})
