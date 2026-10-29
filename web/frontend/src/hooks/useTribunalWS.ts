import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { apiGet, getSecret } from '../lib/api'
import type { DonationPayload, StateChangePayload, SubtitlesPayload, TestimonyPayload, TribunalEventType, VerdictPayload } from '../lib/types'

export interface StenogramEntry {
  id: number
  kind: TribunalEventType | 'local'
  speaker?: string
  text: string
  at: number
}

interface TribunalState {
	queueRevision: number
  connected: boolean
  rttMs: number | null
  phase: string
  caseTitle: string
  defendant: string
  charge: string
  timeLeft: number | null
  judgeLine: string
  verdict: VerdictPayload | null
  stenogram: StenogramEntry[]
  demo: boolean
  mode: 'viewer' | 'streamer' | 'unban'
}

const initial: TribunalState = {
	queueRevision: 0,
  connected: false,
  rttMs: null,
  phase: 'idle',
  caseTitle: '',
  defendant: '',
  charge: '',
  timeLeft: null,
  judgeLine: '',
  verdict: null,
  stenogram: [],
  demo: false,
  mode: 'viewer',
}

let seq = 1

export function useTribunalWS() {
  const [state, setState] = useState<TribunalState>(initial)
  const [retries, setRetries] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)
  const pingAt = useRef(0)

  const push = useCallback((kind: StenogramEntry['kind'], text: string, speaker?: string) => {
    setState((s) => ({
      ...s,
      stenogram: [...s.stenogram.slice(-199), { id: seq++, kind, text, speaker, at: Date.now() }],
    }))
  }, [])

  const send = useCallback((action: string, payload: Record<string, unknown> = {}) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    const secret = getSecret()
    ws.send(JSON.stringify({ action, payload: secret ? { ...payload, secret } : payload }))
    return true
  }, [])

  const panicReset = useCallback(() => {
    setState((s) => ({
      ...s,
      phase: 'idle',
      caseTitle: '',
      defendant: '',
      charge: '',
      timeLeft: null,
      judgeLine: '',
      verdict: null,
      demo: false,
    }))
    push('local', 'Экстренный сброс: заседание завершено')
  }, [push])

  useEffect(() => {
    let closed = false
    let retry: ReturnType<typeof setTimeout>
    let failures = 0

    const retryDelay = () => Math.min(2000 * 2 ** failures, 30000) + Math.floor(Math.random() * 500)

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss://' : 'ws://'
      const secret = getSecret()
      const ws = new WebSocket(proto + location.host + '/ws' + (secret ? `?secret=${encodeURIComponent(secret)}` : ''))
      let stateEvents = 0
      wsRef.current = ws
      let heartbeat: ReturnType<typeof setInterval> | undefined
      let pongWait: ReturnType<typeof setTimeout> | undefined

      const ping = () => {
        if (ws.readyState !== WebSocket.OPEN) return
        pingAt.current = Date.now()
        try {
          ws.send(JSON.stringify({ action: 'ping', payload: {} }))
        } catch {
          return
        }
        clearTimeout(pongWait)
        // no pong in 5s = dead socket, close it so backoff reconnects
        pongWait = setTimeout(() => {
          try {
            ws.close()
          } catch {
            /* already gone */
          }
        }, 5000)
      }

      ws.onopen = () => {
        failures = 0
        setRetries(0)
        setState((s) => ({ ...s, connected: true }))
        ping()
        heartbeat = setInterval(ping, 10000)
        // A fresh tab has missed the events that opened the current trial.
        const revision = stateEvents
        void apiGet<{ trial: StateChangePayload }>('/api/status').then(({ trial }) => {
          if (closed || wsRef.current !== ws || !trial || revision !== stateEvents) return
          setState((s) => ({
            ...s, phase: trial.state, defendant: trial.defendant ?? '', charge: trial.charge ?? '',
            caseTitle: trial.case_title ?? '', demo: trial.demo ?? false, mode: trial.mode ?? 'viewer',
            timeLeft: trial.time_left_sec ?? null,
            judgeLine: trial.line ?? '', verdict: trial.verdict ?? null,
          }))
        }).catch(() => {
          push('local', 'Не удалось восстановить дело. Проверьте связь с сервером.')
        })
      }
      ws.onclose = () => {
        clearInterval(heartbeat)
        clearTimeout(pongWait)
        setState((s) => ({ ...s, connected: false, rttMs: null }))
        if (!closed) {
          failures += 1
          setRetries(failures)
          retry = setTimeout(connect, retryDelay())
        }
      }
      ws.onerror = () => ws.close()
      ws.onmessage = (ev) => {
        let msg: { type: TribunalEventType | 'pong'; payload?: unknown }
        try {
          msg = JSON.parse(ev.data as string)
        } catch {
          return
        }
        if (msg.type === 'pong') {
          clearTimeout(pongWait)
          setState((s) => ({ ...s, rttMs: Date.now() - pingAt.current }))
          return
        }
        switch (msg.type) {
          case 'jury':
            window.dispatchEvent(new CustomEvent('tribunal-jury', { detail: msg.payload }))
            break
          case 'exhibit': {
            const exhibit = msg.payload as { title: string; text: string }
            push('exhibit', `${exhibit.title}: ${exhibit.text}`, 'Материалы дела')
            window.dispatchEvent(new CustomEvent('tribunal-exhibit', { detail: msg.payload }))
            break
          }
          case 'appearance_change':
            window.dispatchEvent(new CustomEvent('tribunal-appearance', { detail: msg.payload }))
            break
          case 'state_change': {
            stateEvents += 1
            const p = msg.payload as StateChangePayload
            setState((s) => ({
              ...s,
              phase: p.state ?? s.phase,
              demo: p.state === 'idle' ? false : (p.demo ?? s.demo),
              mode: p.mode ?? s.mode,
              caseTitle: p.case_title ?? (p.state === 'idle' ? '' : s.caseTitle),
              defendant: p.state === 'idle' ? '' : (p.defendant ?? s.defendant),
              charge: p.state === 'idle' ? '' : (p.charge ?? s.charge),
              timeLeft: p.state === 'testimony' || p.state === 'defense' || p.state === 'jury' ? (p.time_left_sec ?? null) : null,
              judgeLine: p.state === 'indictment' || p.state === 'idle' ? '' : s.judgeLine,
              verdict: p.state === 'indictment' ? null : s.verdict,
              stenogram: p.state === 'indictment' ? [] : s.stenogram,
            }))
            push('state_change', `${p.state}${p.defendant ? ` · ${p.defendant}` : ''}${p.charge ? `: ${p.charge}` : ''}`)
            break
          }
          case 'subtitles': {
            const p = msg.payload as SubtitlesPayload
            setState((s) => ({ ...s, judgeLine: p.text }))
            push('subtitles', p.text, p.speaker)
            break
          }
          case 'testimony': {
            const p = msg.payload as TestimonyPayload
            push('testimony', p.text, p.author)
            break
          }
          case 'verdict': {
            const p = msg.payload as VerdictPayload
            setState((s) => ({ ...s, verdict: p, phase: 'verdict' }))
            push('verdict', `${p.verdict}${p.penalty ? ` · ${p.penalty}` : ''}`)
            break
          }
          case 'panic':
            panicReset()
            break
          case 'queue_change':
            setState(s => ({ ...s, queueRevision: s.queueRevision + 1 }))
            break
          case 'donation': {
            const p = msg.payload as DonationPayload
            const line = `${p.donor}: ${p.amount} ${p.currency}${p.message ? ` (${p.message})` : ''}${p.note ? ` · ${p.note}` : ''}`
            push('donation', line, 'донат')
            toast(`Донат: ${p.donor}: ${p.amount} ${p.currency}`)
            break
          }
          case 'animation':
          case 'audio_chunk':
            break
        }
      }
    }

    connect()
    return () => {
      closed = true
      clearTimeout(retry)
      wsRef.current?.close()
    }
  }, [panicReset, push])

  // stable identity: pool refreshes re-render the provider but must not
  // cascade into every state consumer
  return useMemo(() => ({ ...state, retries, send, push, panicReset }), [state, retries, send, push, panicReset])
}

export type Tribunal = ReturnType<typeof useTribunalWS>
