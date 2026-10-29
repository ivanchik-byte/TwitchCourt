import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Check, Copy, ImagePlus, RotateCcw, Maximize2 } from 'lucide-react'
import { RolePortraits } from './RolePortraits'
import { apiFetch, apiUpload, getSecret } from '../../lib/api'
import { previewTheme, useAppearance, type Appearance, type ConsoleTheme } from '../../tribunal/AppearanceContext'

const themes: { id: ConsoleTheme; name: string; description: string; colors: string[] }[] = [
  { id: 'graphite', name: 'Графит', description: 'Нейтральный пульт, стальной акцент', colors: ['#151617', '#25272b', '#b6c3d5'] },
  { id: 'slate', name: 'Ночной эфир', description: 'Холодный сланец, приглушённый синий', colors: ['#121922', '#212e3d', '#a7bfd9'] },
  { id: 'walnut', name: 'Орех', description: 'Тёплый уголь, латунные детали', colors: ['#1c1917', '#332c26', '#cbb394'] },
]

export function AppearanceSection() {
  const { appearance, error: loadError, refresh, save } = useAppearance()
  const [draft, setDraft] = useState<Appearance | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [frameReady, setFrameReady] = useState(false)
  const [previewPhase, setPreviewPhase] = useState('indictment')
  const [mediaTick, setMediaTick] = useState(0)
  const [copied, setCopied] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null)
  const appliedTheme = useRef(appearance?.theme)

  useEffect(() => {
    if (!appearance) return
    const themeChanged = appliedTheme.current !== appearance.theme
    appliedTheme.current = appearance.theme
    setDraft(current => current ? { ...current, ...(themeChanged ? { theme: appearance.theme } : {}), has_custom_judge: appearance.has_custom_judge, has_custom_background: appearance.has_custom_background, photo_url: appearance.photo_url, background_url: appearance.background_url } : appearance)
  }, [appearance])
  useEffect(() => {
    if (!appearance) return
    return () => previewTheme(appearance.theme)
  }, [appearance])
  useEffect(() => {
    if (!draft) return
    previewTheme(draft.theme)
    if (!frameReady) return
    frame.current?.contentWindow?.postMessage({ type: 'tribunal-preview', appearance: draft, phase: previewPhase, mediaTick }, location.origin)
  }, [draft, frameReady, previewPhase, mediaTick])
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(timer)
  }, [copied])

  if (!draft) return <p role="status">{loadError || 'Загружаем оформление…'}</p>
  const update = (patch: Partial<Appearance>) => {
    setDraft({ ...draft, ...patch })
    setSaved(false)
    if (patch.theme) previewTheme(patch.theme)
  }
  const upload = async (kind: 'judge' | 'court', file?: File) => {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > (kind === 'judge' ? 5 : 8) * 1024 * 1024) {
      setError(`Нужен PNG, JPG или WebP до ${kind === 'judge' ? 5 : 8} МБ.`)
      return
    }
    setBusy(true)
    setError('')
    const form = new FormData()
    form.append('photo', file)
    if (await apiUpload(`/api/${kind}/photo`, form)) {
      await refresh().catch(() => setError('Файл загружен, но не удалось обновить предпросмотр.'))
      setMediaTick(tick => tick + 1)
      setSaved(false)
      if (kind === 'judge') setDraft({ ...draft, judge_preset: 'custom', has_custom_judge: true })
    } else setError('Не удалось загрузить изображение. Проверьте файл, ключ доступа и связь с сервером.')
    setBusy(false)
  }

  return <div className="appearance-workbench">
    <form className="appearance-controls" onSubmit={async event => {
      event.preventDefault()
      setBusy(true)
      setError('')
      setSaved(false)
      try { await save(draft); setSaved(true) }
      catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось сохранить оформление.') }
      setBusy(false)
    }}>
      <section className="settings-panel">
        <div className="section-heading"><span className="section-index">01</span><div><h2>Пульт</h2><p>Три спокойные темы. Шрифт и расположение органов управления сохраняются.</p></div></div>
        <div className="theme-choices" role="group" aria-label="Тема пульта">
          {themes.map(theme => <button type="button" disabled={busy} key={theme.id} className="theme-choice" aria-pressed={draft.theme === theme.id} onClick={() => update({ theme: theme.id })}>
            <span className="theme-sample" style={{ '--sample-bg': theme.colors[0], '--sample-panel': theme.colors[1], '--sample-accent': theme.colors[2] } as CSSProperties}><span /><span /><span /></span>
            <span className="theme-choice-name">{theme.name}{draft.theme === theme.id && <Check size={14} />}</span><small>{theme.description}</small>
          </button>)}
        </div>
      </section>
      <section className="settings-panel">
        <div className="section-heading"><span className="section-index">02</span><div><h2>Судья</h2><p>Талисман шоу. Образ можно сменить, а характер и голос настраиваются отдельно.</p></div></div>
        <div className="portrait-choices" role="group" aria-label="Образ судьи">
          {[['original', 'Оригинал', 'Твой первый образ'], ['magistrate', 'Мировая судья', 'Новая мантия, прозрачный фон'], ['custom', 'Свой персонаж', draft.has_custom_judge ? 'Загруженный портрет' : 'Сначала загрузите изображение']].map(([id, name, description]) => <button type="button" className="portrait-choice" key={id} aria-pressed={draft.judge_preset === id} disabled={busy || (id === 'custom' && !draft.has_custom_judge)} onClick={() => update({ judge_preset: id as Appearance['judge_preset'] })}>
            <span className="portrait-image">{id !== 'custom' || draft.has_custom_judge ? <img src={`/api/judge/photo?preset=${id}&v=${mediaTick}`} alt="" loading="lazy" /> : <ImagePlus size={25} />}</span><span className="theme-choice-name">{name}{draft.judge_preset === id && <Check size={14} />}</span><small>{description}</small>
          </button>)}
        </div>
        <div className="media-actions"><label className="secondary-action upload-label"><ImagePlus size={14} />Загрузить персонажа<input disabled={busy} type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void upload('judge', event.target.files?.[0]); event.target.value = '' }} /></label><span>PNG с прозрачностью, JPG или WebP · до 5 МБ</span></div>
        <p className="media-save-note">Загрузка сразу заменяет ваш файл. Выбор между образами сохраните кнопкой «Применить оформление».</p>
        <label className="setting-switch"><input type="checkbox" disabled={busy} checked={draft.show_judge} onChange={event => update({ show_judge: event.target.checked })} />Показывать портрет говорящего на сцене</label>
        <label className="setting-switch"><input type="checkbox" disabled={busy} checked={draft.reduce_motion} onChange={event => update({ reduce_motion: event.target.checked })} />Убрать движения и переходы</label>
      </section>
      <section className="settings-panel">
        <div className="section-heading"><span className="section-index">03</span><div><h2>Зал суда</h2><p>Можно поставить собственную декорацию. Загрузка и сброс фона сразу обновляют сцену.</p></div></div>
        <div className="background-control"><img src={`/api/court/photo?v=${mediaTick}`} alt="Текущий фон зала суда" /><div><span>{draft.has_custom_background ? 'Свой фон' : 'Стандартный зал'}</span><small>Изображение 16:9 · до 8 МБ</small><label className="secondary-action upload-label"><ImagePlus size={14} />Заменить фон<input disabled={busy} type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void upload('court', event.target.files?.[0]); event.target.value = '' }} /></label>{draft.has_custom_background && <button type="button" className="file-text-button" disabled={busy} onClick={async () => {
          setBusy(true)
          try {
            const response = await apiFetch('/api/court/photo', { method: 'DELETE' })
            if (!response.ok) throw new Error('Не удалось восстановить стандартный фон.')
            await refresh()
            setMediaTick(tick => tick + 1)
          } catch (failure) { setError(failure instanceof Error ? failure.message : 'Нет связи с сервером.') }
          setBusy(false)
        }}><RotateCcw size={13} />Стандартный фон</button>}</div></div>
      </section>
      <RolePortraits />
      <div className="appearance-save"><button className="primary-action" disabled={busy}>{busy ? 'Применяем…' : 'Применить оформление'}</button><span role="status">{saved ? 'Сохранено. Сцена OBS обновлена.' : 'Тему и образ можно примерить до применения.'}</span></div>
      {error && <p className="desk-error" role="alert">{error}</p>}
    </form>
    <aside className="appearance-preview">
      <div className="preview-heading"><span className="connection-dot is-connected" /><h2>Предпросмотр сцены</h2><span>16:9</span><button type="button" aria-label="Развернуть предпросмотр" title="Развернуть предпросмотр" onClick={() => { void frame.current?.requestFullscreen().catch(() => setError('Не удалось развернуть предпросмотр.')) }}><Maximize2 size={14} /></button></div>
      <iframe ref={frame} onLoad={() => setFrameReady(true)} title="Предпросмотр оформления суда" src="/overlay/?preview=1" />
      <div className="preview-phase-tabs" role="group" aria-label="Этап предпросмотра">{[['indictment', 'Начало дела'], ['testimony', 'Показания'], ['verdict', 'Вердикт']].map(([phase, label]) => <button key={phase} type="button" aria-pressed={previewPhase === phase} onClick={() => setPreviewPhase(phase)}>{label}</button>)}</div>
      <p>Учебная сцена без звука. Не запускает заседание и не влияет на эфир.</p>
      <button className="secondary-action" disabled={busy} type="button" onClick={async () => {
        try {
          const secret = getSecret()
          await navigator.clipboard.writeText(`${location.origin}/overlay/${secret ? `?secret=${encodeURIComponent(secret)}` : ''}`)
          setCopied(true)
        } catch { setError('Браузер не разрешил копирование. Адрес источника: /overlay/.') }
      }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Адрес скопирован' : 'Скопировать адрес для OBS'}</button>
      <div className="preview-note"><span>ПЕРЕД ЭФИРОМ</span><p>Добавьте браузерный источник в OBS с размером 1920×1080. Звук заседания идёт через него.</p></div>
    </aside>
  </div>
}
