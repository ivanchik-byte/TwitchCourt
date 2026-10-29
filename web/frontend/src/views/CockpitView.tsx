import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowRight, Check, FileText, Gavel, Play, RotateCcw, Square } from 'lucide-react'
import { toast } from 'sonner'
import { apiGet, apiNote, apiPost } from '../lib/api'
import { modes, phaseLabels, phaseOrder, starterCases, type CourtMode, type ShowCase, type ShowStatus } from '../lib/show'
import type { JuryStatus, UnbanRequest } from '../lib/types'
import { useTribunalActions, useTribunalFeed, useTribunalPhase, useTribunalPool } from '../tribunal/TribunalContext'
import { StenogramLog } from '../components/cockpit/StenogramLog'
import { DefenseDesk } from '../components/show/DefenseDesk'
import { QueueDesk } from '../components/show/QueueDesk'
import { DonationMonitor } from '../components/show/DonationMonitor'
import { ModerationDesk } from '../components/show/ModerationDesk'
import { ExhibitDesk } from '../components/show/ExhibitDesk'
import { JuryDesk } from '../components/show/JuryDesk'

export function CockpitView() {
  const trial = useTribunalPhase()
  const location = useLocation()
  const { judgeLine } = useTribunalFeed()
  const { panic, gavel } = useTribunalActions()
  const pool = useTribunalPool()
  const [draft] = useState(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem('tribunal-draft') || 'null') as { mode?: CourtMode; selected?: ShowCase; nick?: string } | null
      if (stored && ['viewer','streamer','unban'].includes(stored.mode || '') && typeof stored.selected?.crime === 'string' && typeof stored.nick === 'string') return stored as { mode: CourtMode; selected: ShowCase; nick: string }
    } catch { sessionStorage.removeItem('tribunal-draft') }
    return { mode: 'viewer' as CourtMode, selected: starterCases.viewer[0], nick: '' }
  })
  const [mode, setMode] = useState<CourtMode>(draft.mode)
  const [selected, setSelected] = useState<ShowCase>(draft.selected)
  const [nick, setNick] = useState(draft.nick)
  const [status, setStatus] = useState<ShowStatus | null>(null)
  const [statusError, setStatusError] = useState('')
  const [library, setLibrary] = useState<ShowCase[]>([])
  const [appeals, setAppeals] = useState<UnbanRequest[]>([])
  const [appealId, setAppealId] = useState('')
  const [appealsError, setAppealsError] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [activeAppeal, setActiveAppeal] = useState('')
  const [resolved, setResolved] = useState(false)
  const [jury, setJury] = useState<JuryStatus | null>(null)
  const busyRef = useRef(false)
  const active = trial.phase !== 'idle'
  const currentMode = active ? trial.mode : mode
  const modeCopy = modes[currentMode]
  const floorOpen = trial.phase === 'defense' || trial.phase === 'testimony'
  const ballotOpen = active && !!jury?.open_round
  const canAdvance = active && !ballotOpen && (trial.demo || floorOpen || trial.phase === 'jury' || (trial.phase === 'verdict' && !!trial.verdict))
  const steps = jury?.first ? [...phaseOrder.slice(0, 4), 'jury', 'verdict'] : phaseOrder
  const stepIndex = steps.indexOf(trial.phase === 'deliberation' ? 'objection' : trial.phase)

  useEffect(() => { if (!active) setJury(null) }, [active])

  useEffect(() => { sessionStorage.setItem('tribunal-draft', JSON.stringify({ mode, selected, nick })) }, [mode, selected, nick])
  useEffect(() => {
    const prepared = (location.state as { preparedCase?: ShowCase } | null)?.preparedCase
    if (prepared) { setSelected(prepared); if (mode === 'unban') setMode('viewer') }
  }, [location.key])

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await apiGet<ShowStatus>('/api/status'))
      setStatusError('')
    } catch {
      setStatusError('Не удалось проверить подключения. Проверьте сервер и ключ доступа в подготовке.')
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
    const timer = setInterval(refreshStatus, 10000)
    return () => clearInterval(timer)
  }, [refreshStatus])

  useEffect(() => {
    let cancelled = false
    void apiGet<{ cases: ShowCase[] }>('/api/cases').then(({ cases }) => {
      if (!cancelled) setLibrary(cases)
    }).catch(() => {
      if (!cancelled) setError('Ваша колода недоступна. Стартовые дела можно использовать.')
    })
    return () => { cancelled = true }
  }, [])

  const refreshAppeals = useCallback(async () => {
    try {
      const { requests } = await apiGet<{ requests: UnbanRequest[] }>('/api/unban')
      setAppeals(requests ?? [])
      setAppealsError('')
    } catch {
      setAppealsError('Не удалось загрузить апелляции. Проверьте подключение Twitch.')
    }
  }, [])

  useEffect(() => {
    if (mode === 'unban') void refreshAppeals()
  }, [mode, refreshAppeals])

  const switchMode = (next: CourtMode) => {
    setMode(next)
    setError('')
    setNick(next === 'streamer' ? status?.streamer_name ?? '' : '')
    if (next !== 'unban') setSelected(starterCases[next][0])
  }

  const start = async (demo: boolean) => {
    if (busyRef.current || active) return
    busyRef.current = true
    setPending(true)
    setError('')
    const response = demo
      ? await apiPost('/api/demo', { mode })
      : mode === 'unban'
        ? await apiPost('/api/unban/trial', { id: appealId })
        : await apiPost('/api/trial', { defendant: nick.trim(), crime: selected.crime, context: selected.context, viewer: mode === 'viewer', ...(selected.source || library.some(card => card.id === selected.id) ? { case_id: selected.id } : {}) })
    if (!response.ok) setError(apiNote(response.status))
    else {
      setActiveAppeal(!demo && mode === 'unban' ? appealId : '')
      setResolved(false)
    }
    setPending(false)
    busyRef.current = false
  }

  const advance = useCallback(async () => {
    if (!canAdvance || busyRef.current) return
    busyRef.current = true
    setPending(true)
    const response = await apiPost('/api/trial/advance', { phase: trial.phase })
    if (!response.ok) toast.error(response.status === 409 ? 'Этап уже сменился. Дождитесь обновления пульта.' : apiNote(response.status))
    setPending(false)
    busyRef.current = false
  }, [canAdvance, trial.phase])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!active || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      const field = (event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]')
      const panicCodes: Record<string, string> = { escape: 'Escape', f9: 'F9', f12: 'F12', p: 'KeyP' }
      if (event.code === 'Escape' || (!field && event.code === panicCodes[status?.panic_hotkey ?? 'escape'])) {
        event.preventDefault()
        panic()
      } else if (event.code === 'Space' && canAdvance && !field && !(event.target as HTMLElement | null)?.closest('button, a, summary')) {
        event.preventDefault()
        void advance()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, panic, advance, canAdvance, status?.panic_hotkey])

  const selectedAppeal = appeals.find((appeal) => appeal.id === appealId)
  const ready = status?.ai_live && trial.connected && !statusError && (mode === 'unban' ? !!selectedAppeal : !!nick.trim() && !!selected.crime.trim())
  const nextLabel = trial.phase === 'indictment' ? 'Открыть показания'
    : trial.phase === 'testimony' ? 'Перейти к своему слову'
      : trial.phase === 'defense' ? 'Передать слово судье'
        : trial.phase === 'objection' ? jury?.first ? 'Слово присяжным' : 'Объявить вердикт'
          : trial.phase === 'jury' ? 'Перейти к вердикту' : trial.demo ? 'Закончить репетицию' : 'Следующее дело'

  return (
    <div className="show-desk">
      <div className="desk-heading">
        <div className="workspace-title"><h1>Эфир</h1><span>{active ? phaseLabels[trial.phase] : 'Нет активного дела'}</span></div>
        <div className="desk-heading-actions"><Link to="/settings" className="quiet-link">Подготовка эфира <ArrowRight size={15} /></Link>{active && <button className="stop-button" onClick={panic}><Square size={13} /> Остановить <kbd>Esc</kbd></button>}</div>
      </div>

      <div className="mode-selector" role="group" aria-label="Режим суда">
        {(Object.keys(modes) as CourtMode[]).map((key, index) => (
          <button key={key} disabled={active || pending} aria-pressed={currentMode === key} className={`mode-option ${currentMode === key ? 'is-selected' : ''}`} onClick={() => switchMode(key)}>
            <span className="mode-number" aria-hidden="true">0{index + 1}</span><span><strong>{modes[key].name}</strong><small>{modes[key].role}</small></span>
          </button>
        ))}
      </div>

      {(error || statusError) && <div className="desk-error" role="alert">{error || statusError} <Link to="/settings">Открыть подготовку</Link></div>}

      <div className="desk-layout">
        <div className="desk-main">
          <section className={`case-file ${active ? 'is-in-session' : ''} ${trial.phase === 'defense' ? 'is-defense' : ''}`} aria-label={active ? 'Текущее дело' : 'Подготовка дела'}>
            <div className="case-file-top"><span><FileText size={14} /> {active ? 'Заседание открыто' : 'Следующее дело'}</span><span>{active && trial.demo ? 'РЕПЕТИЦИЯ' : modeCopy.short}</span></div>
            {active ? <>
              <ol className="trial-progress" style={{ gridTemplateColumns: `repeat(${steps.length},minmax(0,1fr))` }} aria-label="Ход заседания">{steps.map((phase, index) => <li key={phase} className={index === stepIndex ? 'is-current' : index < stepIndex ? 'is-complete' : ''} aria-current={index === stepIndex ? 'step' : undefined}><span>{index < stepIndex ? <Check size={12} /> : `0${index + 1}`}</span>{phase === 'jury' ? 'Присяжные' : phase === 'objection' && trial.phase === 'deliberation' ? 'Совещание' : phaseLabels[phase]}</li>)}</ol>
              <div className="case-file-body"><div className="case-live-meta"><p className="case-participant">На скамье / {trial.defendant}</p><div className="stage-caption"><span className="stage-dot" />{phaseLabels[trial.phase] ?? trial.phase}<PhaseClock seconds={trial.timeLeft} phase={trial.phase} paused={ballotOpen} /></div></div><h2>{trial.charge}</h2>
                <div className="judge-quote" aria-live="polite"><span>{trial.demo ? 'Сценарная реплика' : 'Последняя реплика'}</span><p>{judgeLine || 'Суд готовит ответ…'}</p></div>
                {trial.verdict && <div className="ruling"><strong>{trial.verdict.verdict}</strong><p>{trial.verdict.penalty}</p></div>}
                {!trial.demo && selected.crime === trial.charge && <CaseReference card={selected} />}
                {trial.phase === 'testimony' && <p className="floor-prompt">Показания из чата. Когда все высказались, переходите к своему слову.</p>}
              </div>
              <div className="case-file-footer"><button className="primary-action" disabled={!canAdvance || pending} onClick={() => void advance()}>{ballotOpen ? 'Идёт голосование' : canAdvance ? nextLabel : trial.phase === 'verdict' ? 'Суд объявляет решение' : 'Судья говорит'}<ArrowRight size={18} /></button><button className="file-secondary" onClick={gavel} disabled={trial.demo || pending}><Gavel size={16} /> Молоток</button></div>
            </> : <>
              <div className={`case-file-body ${mode !== 'unban' ? 'case-preparation' : ''}`}>
                {mode === 'unban' ? <>
                  <p className="case-participant">Апелляционный день</p><h2>Апелляции на разбан</h2><p className="case-description">Выберите заявку из Twitch. Ведущий обвиняет, ИИ выступает адвокатом.</p>
                  <label className="file-label">Заявка<select value={appealId} onChange={(event) => setAppealId(event.target.value)}><option value="">{appeals.length ? 'Выберите участника' : 'Заявок пока нет'}</option>{appeals.map((appeal) => <option key={appeal.id} value={appeal.id}>{appeal.user || appeal.user_login}</option>)}</select></label>
                  {selectedAppeal && <blockquote className="appeal-text">{selectedAppeal.text}</blockquote>}
                  <button className="file-text-button" onClick={() => void refreshAppeals()}><RotateCcw size={13} /> Обновить список</button>
                  {appealsError && <p role="alert" className="file-warning">{appealsError}</p>}
                  {!appeals.length && <p className="file-hint">Для настоящих заявок подключите Twitch в подготовке. Учебное дело доступно в репетиции.</p>}
                </> : <>
                  <label className="case-participant" htmlFor="case-select">Материалы заседания</label>
                  <select id="case-select" className="case-title-select" value={selected.id} onChange={(event) => {
                    const card = [...starterCases[mode], ...library].find((candidate) => candidate.id === event.target.value)
                    if (card) setSelected(card)
                  }}>{![...starterCases[mode], ...library].some(card => card.id === selected.id) && <option value={selected.id}>{selected.title}</option>}<optgroup label="Для первого эфира">{starterCases[mode].map((card) => <option key={card.id} value={card.id}>{card.title}</option>)}</optgroup>{library.length > 0 && <optgroup label="Ваша колода">{library.map((card) => <option key={card.id} value={card.id}>{card.title}</option>)}</optgroup>}</select>
                  <div className="case-setup-grid">
                    <div className="case-inputs">
                      <label className="file-label">{mode === 'viewer' ? 'Никнейм зрителя' : 'Имя стримера'}<input value={nick} onChange={(event) => setNick(event.target.value)} placeholder={mode === 'viewer' ? 'Кого защищаем?' : 'Кто на скамье?'} autoComplete="off" maxLength={64} list={mode === 'viewer' ? 'court-queue' : undefined} /></label>
                      <datalist id="court-queue">{pool.map((seat) => <option key={seat.nick} value={seat.nick} />)}</datalist>
                      <label className="file-label">Обвинение<textarea rows={3} value={selected.crime} onChange={(event) => setSelected({ ...selected, crime: event.target.value })} maxLength={300} /></label>
                      <label className="file-label evidence-field">Что известно в начале<textarea rows={4} value={selected.context} onChange={(event) => setSelected({ ...selected, context: event.target.value })} maxLength={1000} /></label>
                    </div>
                    <CaseBrief card={selected} role={modeCopy.role} />
                  </div>
                </>}
              </div>
              <div className="case-file-footer"><button className="primary-action" onClick={() => void start(false)} disabled={!ready || pending}><Play size={17} />Начать заседание<ArrowRight size={18} /></button>{!status?.ai_live ? <Link className="launch-note launch-link" to="/settings?section=ai">Подключить языковую модель<ArrowRight size={12} /></Link> : <span className="launch-note">Материалы появятся на оверлее</span>}</div>
            </>}
          </section>

          {trial.phase === 'defense' && !trial.demo && <DefenseDesk enabled={trial.phase === 'defense'} demo={false} mode={currentMode} />}
          {trial.phase === 'verdict' && currentMode === 'viewer' && !trial.demo && <ModerationDesk user={trial.defendant} />}
          {currentMode === 'unban' && activeAppeal && !trial.demo && (trial.phase === 'verdict' || !active) && <section className="desk-panel appeal-decision"><h2>Решение по апелляции</h2><p>Эти кнопки отправляют ваше решение в Twitch.</p>{resolved ? <p>Решение отправлено.</p> : <div className="flex flex-wrap gap-3">{[true, false].map((approve) => <button className="secondary-action" disabled={pending} key={String(approve)} onClick={async () => {
            setPending(true)
            const response = await apiPost('/api/unban/resolve', { id: activeAppeal, approve, text: '' })
            if (response.ok) { setResolved(true); void refreshAppeals() }
            else toast.error(apiNote(response.status))
            setPending(false)
          }}>{approve ? 'Одобрить разбан' : 'Оставить бан'}</button>)}</div>}</section>}
        </div>

        <aside className="desk-sidebar">
          {active && <JuryDesk phase={trial.phase} connected={trial.connected} onChange={setJury} />}
          {active && !trial.demo && <ExhibitDesk phase={trial.phase} connected={trial.connected} blocked={jury?.open_round === 1} />}
          {currentMode === 'viewer' && <QueueDesk active={active} onSelect={seat => {
            setNick(seat.nick)
            if (seat.reason) setSelected({ id: `entry:${seat.nick}`, title: `Дело ${seat.nick}`, crime: seat.reason, context: 'Причина указана участником при входе в очередь.' })
          }} />}

          {!active && <section className="rehearsal-panel"><h2>Пробный прогон</h2><p>Учебное дело с готовыми репликами. Без ключей, озвучки и действий в Twitch.</p><button className="secondary-action" onClick={() => void start(true)} disabled={!trial.connected || pending}><Play size={15} /> Попробовать репетицию<ArrowRight size={15} /></button></section>}
          {trial.demo && <section className="rehearsal-panel"><p className="eyebrow">Репетиция</p><p>Это готовый сценарий. Реплики не зависят от вашего ответа. Нажимайте основную кнопку, чтобы пройти все этапы. Звук и модерация выключены.</p></section>}
          {active && <details className="transcript-drawer"><summary>Протокол заседания</summary><StenogramLog /></details>}
          <section className="desk-panel connections-panel"><p className="eyebrow">Перед эфиром</p><Link to="/settings?section=ai"><span className={`readiness-dot ${status?.ai_live && !statusError ? 'is-ready' : ''}`} /><span>Языковая модель<small>{statusError ? 'Не удалось проверить' : status?.ai_live ? 'Настроена · проверьте ответ' : 'Нужно подключить'}</small></span><ArrowRight size={14} /></Link><Link to="/settings?section=voice"><span className={`readiness-dot ${status?.tts_enabled && !status.tts_beep && !statusError ? 'is-ready' : ''}`} /><span>Голос судьи<small>{status?.tts_enabled ? status.tts_beep ? 'Тестовый сигнал' : `${status.tts_engine} · нужно прослушать` : 'Выключен'}</small></span><ArrowRight size={14} /></Link><Link to="/settings?section=twitch"><span className={`readiness-dot ${status?.twitch_configured && !statusError ? 'is-ready' : ''}`} /><span>Twitch<small>{status?.twitch_configured ? 'Данные подключения заданы' : 'Для очереди и апелляций'}</small></span><ArrowRight size={14} /></Link></section>
          <DonationMonitor />
        </aside>
      </div>
      <footer className="desk-footer"><span>Звук заседания идёт через оверлей OBS.</span><Link to="/settings?section=rules">Правила и параметры суда <ArrowRight size={12} /></Link></footer>
    </div>
  )
}

function PhaseClock({ seconds, phase, paused }: { seconds: number | null; phase: string; paused: boolean }) {
  const [left, setLeft] = useState(seconds)
  useEffect(() => {
    setLeft(seconds)
    if (seconds == null || paused) return
    const timer = setInterval(() => setLeft((value) => value === null ? null : Math.max(0, value - 1)), 1000)
    return () => clearInterval(timer)
  }, [seconds, phase, paused])
  if (left === null) return null
  return <span className="phase-clock">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>
}

function CaseBrief({ card, role }: { card: ShowCase; role: string }) {
  return <aside className="case-brief" aria-label="Заметки ведущему">
    <div className="case-brief-heading"><span className="eyebrow">Заметки ведущему</span><span>{role}</span></div>
    {card.dilemma && <section><h3>О чём спор</h3><p>{card.dilemma}</p></section>}
    <section><h3>Зацепка для защиты</h3><p>{card.defense_example || card.hint || 'Найдите объяснение поступку, которое суд ещё не услышал. Контекст и обвинение можно поправить слева.'}</p></section>
    {card.question && <section><h3>Спросить у чата</h3><p>{card.question}</p></section>}
    {card.details && <details className="brief-materials"><summary>Остальные материалы</summary><p>{card.details}</p></details>}
    {!!card.exhibits?.length && <p className="brief-exhibits"><FileText size={13} />Дополнительных улик: {card.exhibits.length}. После начала дела их можно раскрыть отдельно.</p>}
  </aside>
}

function CaseReference({ card }: { card: ShowCase }) {
  if (!card.details && !card.defense_example && !card.dilemma && !card.question) return null
  return <details className="case-reference">
    <summary>Материалы дела и зацепка для защиты</summary>
    {card.details && <><h3>Материалы</h3><p>{card.details}</p></>}
    {card.dilemma && <><h3>О чём спор</h3><p>{card.dilemma}</p></>}
    {card.defense_example && <><h3>Зацепка для ведущего</h3><p>{card.defense_example}</p></>}
    {card.question && <><h3>Вопрос в зал</h3><p>{card.question}</p></>}
  </details>
}
