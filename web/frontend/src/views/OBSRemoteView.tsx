import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { getSecret } from '../lib/api'
import type OBSWebSocket from 'obs-websocket-js'

interface SceneItem {
  sceneItemId: number
  sourceName: string
  sceneItemEnabled: boolean
}

interface Preset {
  name: string
  hint: string
  plan: (items: SceneItem[], canvas: { w: number; h: number }) => string[]
  apply: (obs: OBSWebSocket, scene: string, items: SceneItem[], canvas: { w: number; h: number }) => Promise<void>
}

function showName(item: SceneItem | undefined, fallback: string): string {
  return item ? `«${item.sourceName}»` : fallback
}

function find(items: SceneItem[], ...needles: string[]): SceneItem | undefined {
  return items.find((i) => needles.some((n) => i.sourceName.toLowerCase().includes(n)))
}

async function setVisible(obs: OBSWebSocket, scene: string, item: SceneItem | undefined, enabled: boolean) {
  if (!item) return
  await obs.call('SetSceneItemEnabled', { sceneName: scene, sceneItemId: item.sceneItemId, sceneItemEnabled: enabled })
}

async function setBounds(obs: OBSWebSocket, scene: string, item: SceneItem | undefined, x: number, y: number, w: number, h: number) {
  if (!item) return
  await obs.call('SetSceneItemTransform', {
    sceneName: scene,
    sceneItemId: item.sceneItemId,
    sceneItemTransform: {
      positionX: x,
      positionY: y,
      boundsType: 'OBS_BOUNDS_SCALE_INNER',
      boundsWidth: w,
      boundsHeight: h,
    },
  })
}

const PRESETS: Preset[] = [
  {
    name: 'Камера крупно',
    hint: 'Камера на весь экран, оверлей скрыт',
    plan: (items, canvas) => {
      const cam = find(items, 'камера', 'camera', 'вебка', 'webcam', 'video capture')
      const court = find(items, 'court', 'суд', 'трибунал', 'browser', 'оверлей')
      return [
        `${showName(cam, 'камера не найдена')} → весь экран ${canvas.w}x${canvas.h}, вкл`,
        `${showName(court, 'оверлей не найден')} → выкл`,
      ]
    },
    apply: async (obs, scene, items, canvas) => {
      const cam = find(items, 'камера', 'camera', 'вебка', 'webcam', 'video capture')
      const court = find(items, 'court', 'суд', 'трибунал', 'browser', 'оверлей')
      if (cam) {
        await setVisible(obs, scene, cam, true)
        await setBounds(obs, scene, cam, 0, 0, canvas.w, canvas.h)
      }
      await setVisible(obs, scene, court, false)
    },
  },
  {
    name: 'Зал целиком',
    hint: 'Оверлей суда на весь экран',
    plan: (items, canvas) => {
      const court = find(items, 'court', 'суд', 'трибунал', 'browser', 'оверлей')
      return [`${showName(court, 'оверлей не найден')} → весь экран ${canvas.w}x${canvas.h}, вкл`]
    },
    apply: async (obs, scene, items, canvas) => {
      const court = find(items, 'court', 'суд', 'трибунал', 'browser', 'оверлей')
      if (court) {
        await setVisible(obs, scene, court, true)
        await setBounds(obs, scene, court, 0, 0, canvas.w, canvas.h)
      }
    },
  },
  {
    name: 'Судья в углу',
    hint: 'Зал суда и портрет судьи в правом нижнем углу',
    plan: (items, canvas) => {
      const court = find(items, 'court', 'суд', 'трибунал', 'browser', 'оверлей')
      const judge = find(items, 'судья', 'judge')
      return [
        `${showName(court, 'оверлей не найден')} → весь экран, вкл`,
        `${showName(judge, 'судья не найден')} → правый нижний угол, вкл`,
      ]
    },
    apply: async (obs, scene, items, canvas) => {
      const court = find(items, 'court', 'суд', 'трибунал', 'browser', 'оверлей')
      const judge = find(items, 'судья', 'judge')
      await setVisible(obs, scene, court, true)
      if (court) await setBounds(obs, scene, court, 0, 0, canvas.w, canvas.h)
      if (judge) {
        await setVisible(obs, scene, judge, true)
        await setBounds(obs, scene, judge, Math.round(canvas.w * 0.76), Math.round(canvas.h * 0.63), Math.round(canvas.w * 0.21), Math.round(canvas.h * 0.32))
      }
    },
  },
]

export function OBSRemoteView() {
  const [host, setHost] = useState(localStorage.getItem('obs-host') || '127.0.0.1')
  const [port, setPort] = useState(localStorage.getItem('obs-port') || '4455')
  const [password, setPassword] = useState(() => sessionStorage.getItem('obs-password') || '')
  const [connected, setConnected] = useState(false)
  const [scenes, setScenes] = useState<string[]>([])
  const [scene, setScene] = useState('')
  const [items, setItems] = useState<SceneItem[]>([])
  const [canvas, setCanvas] = useState({ w: 1920, h: 1080 })
  const secret = getSecret()
  const overlayURL = `${location.origin}/overlay/${secret ? `?secret=${encodeURIComponent(secret)}` : ''}`
  const obsRef = useRef<OBSWebSocket | null>(null)

  const disconnect = useCallback(async () => {
    try {
      await obsRef.current?.disconnect()
    } catch {
      /* already down */
    }
    obsRef.current = null
    setConnected(false)
    setItems([])
  }, [])

  useEffect(() => () => void disconnect(), [disconnect])

  const refresh = useCallback(async () => {
    const obs = obsRef.current
    if (!obs || !scene) return
    try {
      const { scenes: list } = await obs.call('GetSceneList')
      setScenes(list.map((s) => s.sceneName as string))
      const { sceneItems } = await obs.call('GetSceneItemList', { sceneName: scene })
      setItems(
        (sceneItems as Array<{ sceneItemId: number; sourceName: string; sceneItemEnabled: boolean }>).map((i) => ({
          sceneItemId: i.sceneItemId,
          sourceName: i.sourceName,
          sceneItemEnabled: i.sceneItemEnabled,
        })),
      )
    } catch {
      toast.error('OBS не отвечает: проверьте соединение')
    }
  }, [scene])

  useEffect(() => {
    if (connected && scene) void refresh()
  }, [connected, scene, refresh])

  const connect = async () => {
    await disconnect()
    let obs: OBSWebSocket | null = null
    try {
      const { default: OBSWebSocket } = await import('obs-websocket-js')
      obs = new OBSWebSocket()
      await obs.connect(`ws://${host}:${port}`, password || undefined)
      obsRef.current = obs
      localStorage.setItem('obs-host', host)
      localStorage.setItem('obs-port', port)
      sessionStorage.setItem('obs-password', password)
      const { currentProgramSceneName } = await obs.call('GetCurrentProgramScene')
      setScene(currentProgramSceneName as string)
      try {
        const vs = await obs.call('GetVideoSettings')
        const w = Number((vs as { baseWidth?: number }).baseWidth)
        const h = Number((vs as { baseHeight?: number }).baseHeight)
        if (w > 0 && h > 0) setCanvas({ w, h })
      } catch {
        /* keep default canvas */
      }
      setConnected(true)
      toast.success('OBS подключен')
    } catch {
      try {
        await obs?.disconnect()
      } catch {
        /* already down */
      }
      obsRef.current = null
      setConnected(false)
      toast.error('Не удалось подключиться: включите сервер WebSocket в OBS (Инструменты → Настройки сервера WebSocket) и проверьте пароль')
    }
  }

  const toggle = async (item: SceneItem) => {
    const obs = obsRef.current
    if (!obs) return
    try {
      await obs.call('SetSceneItemEnabled', {
        sceneName: scene,
        sceneItemId: item.sceneItemId,
        sceneItemEnabled: !item.sceneItemEnabled,
      })
      setItems((prev) => prev.map((i) => (i.sceneItemId === item.sceneItemId ? { ...i, sceneItemEnabled: !i.sceneItemEnabled } : i)))
    } catch {
      toast.error('OBS отклонил команду')
    }
  }

  const runPreset = async (p: Preset) => {
    const obs = obsRef.current
    if (!obs || !scene) return
    const lines = p.plan(items, canvas)
    if (!window.confirm(`${p.name}:\n${lines.join('\n')}\n\nПрименить к сцене «${scene}»?`)) return
    try {
      await p.apply(obs, scene, items, canvas)
      toast.success(p.name)
      void refresh()
    } catch {
      toast.error('Пресет не применился: проверьте названия источников в сцене')
    }
  }

  return (
    <div className="setup-page obs-page">
      <div className="desk-heading"><div><p className="eyebrow">Трансляция</p><h1>OBS</h1></div></div>
      <section className="settings-panel obs-source"><p className="eyebrow">01 / Браузерный источник</p><h2>Сцена суда</h2><p>Добавьте источник «Браузер» в OBS и вставьте этот адрес.</p>
        <label>Адрес сцены<div className="obs-url"><input readOnly value={overlayURL} onFocus={event => event.currentTarget.select()} /><button className="secondary-action" onClick={async () => { try { await navigator.clipboard.writeText(overlayURL); toast.success('Адрес сцены скопирован') } catch { toast.error('Выделите и скопируйте адрес вручную') } }}>Копировать</button></div></label>
        <div className="obs-source-meta"><span>1920 × 1080</span><span>Звук через браузерный источник OBS</span><a className="quiet-link" href={overlayURL} target="_blank" rel="noreferrer">Открыть сцену</a></div>
        <details><summary>Как проверить изображение и звук</summary><p>Установите размер источника 1920 × 1080. Включите «Управлять звуком через OBS», затем «Мониторинг и вывод» в расширенных свойствах аудио. Репетиция на вкладке «Эфир» проверяет изображение без речи; настоящий голос сначала прослушайте в настройках, затем проверьте на реальном деле.</p></details>
      </section>
      <section className="settings-panel obs-remote"><p className="eyebrow">02 / Необязательно</p>
        <h2>Управление OBS</h2>
        <p className="text-xs text-zinc-500">
          Для переключения сцен включите WebSocket в OBS: «Инструменты → Настройки сервера WebSocket». Для показа самой сцены суда это подключение не требуется.
        </p>
        <div className="obs-connection-form">
          <label>Адрес<input value={host} onChange={event => setHost(event.target.value)} placeholder="127.0.0.1" autoComplete="off" /></label>
          <label>Порт<input value={port} onChange={event => setPort(event.target.value.replace(/[^0-9]/g, ''))} placeholder="4455" inputMode="numeric" /></label>
          <label>Пароль OBS<input value={password} onChange={event => setPassword(event.target.value)} type="password" placeholder="Из настроек WebSocket" autoComplete="off" /></label>
          {connected ? (
            <button onClick={() => void disconnect()} className="secondary-action">
              Отключить
            </button>
          ) : (
            <button onClick={() => void connect()} className="primary-action">
              Подключить
            </button>
          )}
        </div>
        <p className={`font-mono text-xs ${connected ? 'text-emerald-300' : 'text-zinc-500'}`}>
          {connected ? `Подключено · сцена: ${scene || '—'}` : 'Не подключено'}
        </p>
      </section>

      {connected && (
        <>
          <div className="card space-y-2 p-4">
            <h2 className="font-semibold">Пресеты камеры</h2>
            <div className="mb-2 flex flex-wrap gap-1.5">
              <select value={scene} onChange={(e) => setScene(e.target.value)}
                className="h-9 rounded-lg border border-white/10 bg-black/40 px-2 text-sm text-white">
                {scenes.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <button onClick={() => void refresh()} className="pressable rounded-lg border border-white/10 px-3 py-1.5 text-sm">
                Обновить
              </button>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-3">
              {PRESETS.map((p) => (
                <button key={p.name} onClick={() => void runPreset(p)}
                  className="pressable rounded-lg border border-white/10 bg-white/5 p-3 text-left">
                  <span className="block text-sm font-semibold">{p.name}</span>
                  <span className="block text-xs text-zinc-500">{p.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="card space-y-1 p-4">
            <h2 className="font-semibold">Источники сцены</h2>
            {items.length === 0 && <p className="text-sm text-zinc-600">Список источников пуст.</p>}
            {items.map((i) => (
              <div key={i.sceneItemId} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
                <span className={`h-2 w-2 rounded-full ${i.sceneItemEnabled ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                <span className="min-w-0 flex-1 truncate text-sm">{i.sourceName}</span>
                <button onClick={() => void toggle(i)}
                  className="pressable rounded-md border border-white/10 px-2 py-0.5 text-xs text-zinc-300">
                  {i.sceneItemEnabled ? 'Скрыть' : 'Показать'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
