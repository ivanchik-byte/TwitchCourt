import { useCallback, useEffect, useRef, useState } from 'react'
import { HelpTip } from '../HelpTip'
import { apiGet, apiPostJson } from '../../lib/api'
import type { JuryRound, JuryStatus } from '../../lib/types'

export function JuryDesk({ phase, connected, onChange }: { phase: string; connected: boolean; onChange: (jury: JuryStatus) => void }) {
  const [jury, setJury] = useState<JuryStatus | null>(null)
  const latest = useRef<JuryStatus | null>(null)
  const [seconds, setSeconds] = useState(20)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [testNick, setTestNick] = useState('demo_anya')
  const accept = useCallback((view: JuryStatus) => {
    if (latest.current?.epoch === view.epoch && latest.current.revision > view.revision) return
    latest.current = view
    setJury(view)
    onChange(view)
  }, [onChange])
  const refresh = useCallback(async () => { accept(await apiGet<JuryStatus>('/api/jury')) }, [accept])

  useEffect(() => {
    let active = true
    const sync = async () => {
      try { const view = await apiGet<JuryStatus>('/api/jury'); if (active) { accept(view); setError('') } }
      catch { if (active) setError('Не удалось получить голосование. Проверьте связь.') }
    }
    void sync()
    const timer = setInterval(sync, 3000)
    const receive = (event: Event) => { if (active) accept((event as CustomEvent<JuryStatus>).detail) }
    window.addEventListener('tribunal-jury', receive)
    return () => { active = false; clearInterval(timer); window.removeEventListener('tribunal-jury', receive) }
  }, [phase, connected, accept])

  const submit = async (path: string, fields: Record<string, unknown>) => {
    if (!jury || pending) return
    setPending(true)
    setError('')
    const response = await apiPostJson<JuryStatus>(path, { epoch: jury.epoch, trial_id: jury.trial_id, ...fields })
    if (response.ok && response.data) accept(response.data)
    else {
      setError(response.status === 409 ? 'Голосование или этап уже изменились. Данные обновлены.' : 'Действие не выполнено. Проверьте связь и ключ доступа.')
      try { await refresh() } catch { setError('Связь потеряна. Действие не подтверждено сервером.') }
    }
    setPending(false)
  }
  const openRound = jury?.open_round === 1 ? jury.first : jury?.open_round === 2 ? jury.second : undefined
  return <section className="desk-panel jury-desk" aria-label="Присяжные">
    <div className="panel-heading"><h2>Присяжные <HelpTip label="Голосование присяжных">Первое мнение собирается на показаниях до защиты и раскрытия улики. Второе — после ответа суда. Один зритель может изменить свой голос до закрытия; результаты появляются после подсчёта.</HelpTip></h2>{openRound && <BallotClock deadline={openRound.closes_at_ms!} />}</div>
    {!jury ? <p>Получаем голосование…</p> : <>
      {openRound ? <>
        <p>{openRound.number === 1 ? 'Первое мнение' : 'После обсуждения'} · голосов: {openRound.total}</p>
        <div className="jury-commands"><span><kbd>!vote 1</kbd> виновен</span><span><kbd>!vote 2</kbd> невиновен</span></div>
        <p>Можно изменить голос до закрытия. Расклад появится после подсчёта.</p>
        <button className="secondary-action jury-main-action" disabled={pending || !connected} onClick={() => void submit('/api/jury', { action: 'close', poll_id: openRound.id })}>Закрыть голосование</button>
      </> : <>
        {(jury.can_first || jury.can_second) && <div className="jury-start"><label>Длительность<select aria-label="Длительность голосования" value={seconds} disabled={pending} onChange={event => setSeconds(Number(event.target.value))}>{[5, 10, 15, 20, 30, 45, 60].map(value => <option key={value} value={value}>{value} сек.</option>)}</select></label><button className="secondary-action" disabled={pending || !connected} onClick={() => void submit('/api/jury', { action: 'open', round: jury.can_first ? 1 : 2, seconds, revision: jury.revision })}>{jury.can_first ? 'Первое мнение' : 'Второе мнение'}</button></div>}
        {!jury.first && !jury.can_first && <p>{phase === 'indictment' ? 'Голосование доступно на показаниях.' : phase === 'verdict' ? 'Дело прошло без голосования.' : 'Сейчас голосование закрыто.'}</p>}
        {jury.first && !jury.second && !jury.can_second && phase !== 'verdict' && <p>Второе мнение откроется после ответа суда. Приобщите улику и обсудите её до этого.</p>}
      </>}
      {jury.first?.status === 'closed' && <RoundResult round={jury.first} />}
      {jury.second?.status === 'closed' && <RoundResult round={jury.second} />}
      {jury.comparison && <p className="jury-comparison">{jury.comparison.compared > 0 ? <>Изменили решение: <strong>{jury.comparison.changed}</strong> из {jury.comparison.compared}, голосовавших оба раза.</> : 'Никто не проголосовал оба раза.'}</p>}
      {phase === 'verdict' && jury.first && !jury.second && <p>Второе мнение пропущено.</p>}
      {phase === 'jury' && !openRound && !jury.second && <p>Можно открыть второе мнение или перейти к вердикту основной кнопкой.</p>}
      {jury.demo && openRound && <details className="jury-test"><summary>Учебные голоса</summary><p>Только репетиция. Настоящие сообщения чата здесь не считаются.</p><label>Учебный зритель<select aria-label="Учебный зритель" value={testNick} onChange={event => setTestNick(event.target.value)}><option value="demo_anya">Аня</option><option value="demo_boris">Борис</option><option value="demo_vera">Вера</option><option value="demo_denis">Денис</option></select></label><div>{['1', '2'].map(choice => <button key={choice} className="secondary-action" disabled={pending || !connected} onClick={() => void submit('/api/jury/test-vote', { poll_id: openRound.id, nick: testNick, choice })}>{choice === '1' ? 'Виновен' : 'Невиновен'}</button>)}</div></details>}
    </>}
    {error && <p className="panel-error" role="alert">{error}</p>}
  </section>
}

function RoundResult({ round }: { round: JuryRound }) {
  const guiltyPercent = round.total ? Math.round((round.guilty ?? 0) * 100 / round.total) : 0
  return <div className="jury-result"><div><span>{round.number === 1 ? 'До защиты' : 'После обсуждения'}</span><span>Голосов: {round.total}</span></div>{round.total ? <><div className="jury-bar" aria-label={`Виновен: ${guiltyPercent}%, невиновен: ${100 - guiltyPercent}%`}><span style={{ width: `${guiltyPercent}%` }} /></div><div><span>Виновен {round.guilty} · {guiltyPercent}%</span><span>Невиновен {round.innocent} · {100 - guiltyPercent}%</span></div></> : <p>Никто не проголосовал.</p>}</div>
}

function BallotClock({ deadline }: { deadline: number }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))
    tick()
    const timer = setInterval(tick, 250)
    return () => clearInterval(timer)
  }, [deadline])
  return <span className="jury-clock">{left > 0 ? `${left} сек.` : 'Подсчёт…'}</span>
}
