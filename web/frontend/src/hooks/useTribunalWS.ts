import { useCallback, useEffect, useRef, useState } from 'react'
import type { StateChangePayload, SubtitlesPayload, TestimonyPayload, TribunalEventType, VerdictPayload } from '../lib/types'

export interface StenogramEntry {
  id: number
  kind: TribunalEventType | 'local'
  speaker?: string
  text: string
  at: number
}

interface TribunalState {
  connected: boolean
  rttMs: number | null
  phase: string
  defendant: string
  charge: string
  timeLeft: number | null
  judgeLine: string
  verdict: VerdictPayload | null
  stenogram: StenogramEntry[]
}

const initial: TribunalState = {
  connected: false,
  rttMs: null,
  phase: 'idle',
  defendant: '',
  charge: '',
  timeLeft: null,
  judgeLine: '',
  verdict: null,
  stenogram: [],
}

let seq = 1

export function useTribunalWS() {
  const [state, setState] = useState<TribunalState>(initial)
  const wsRef = useRef<WebSocket | null>(null)
  const pingAt = useRef(0)

  const push = useCallback((kind: StenogramEntry['kind'], text: string, speaker?: string) => {
    setState((s) => ({
      ...s,
      stenogram: [...s.stenogram.slice(-199), { id: seq++, kind, text, speaker, at: Date.now() }],
    }))
  }, [])

  const send = useCallback((action: string, payload: unknown) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    ws.send(JSON.stringify({ action, payload }))
    return true
  }, [])

  const panicReset = useCallback(() => {
    setState((s) => ({
      ...s,
      phase: 'idle',
      defendant: '',
      charge: '',
      timeLeft: null,
      judgeLine: '',
      verdict: null,
    }))
    push('local', 'Паника: зал очищен')
  }, [push])

  useEffect(() => {
    let closed = false
    let retry: ReturnType<typeof setTimeout>

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss://' : 'ws://'
      const ws = new WebSocket(proto + location.host + '/ws')
      wsRef.current = ws

      ws.onopen = () => {
        setState((s) => ({ ...s, connected: true }))
        pingAt.current = Date.now()
        try {
          ws.send(JSON.stringify({ action: 'ping', payload: {} }))
        } catch {
          /* hub drops unknown actions silently */
        }
      }
      ws.onclose = () => {
        setState((s) => ({ ...s, connected: false, rttMs: null }))
        if (!closed) retry = setTimeout(connect, 2000)
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
          setState((s) => ({ ...s, rttMs: Date.now() - pingAt.current }))
          return
        }
        switch (msg.type) {
          case 'state_change': {
            const p = msg.payload as StateChangePayload
            setState((s) => ({
              ...s,
              phase: p.state ?? s.phase,
              defendant: p.defendant ?? s.defendant,
              charge: p.charge ?? s.charge,
              timeLeft: typeof p.time_left_sec === 'number' ? p.time_left_sec : s.timeLeft,
            }))
            push('state_change', `${p.state}${p.defendant ? ` · ${p.defendant}` : ''}${p.charge ? ` — ${p.charge}` : ''}`)
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
          case 'donation':
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

  return { ...state, send, push, panicReset }
}

export type Tribunal = ReturnType<typeof useTribunalWS>
