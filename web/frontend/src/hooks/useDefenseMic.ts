import { useCallback, useEffect, useRef, useState } from 'react'

interface DefenseMic {
  supported: boolean
  listening: boolean
  error: string
  transcript: string
  start: () => void
  stop: () => void
}

interface SpeechRec {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((ev: SpeechResultEvent) => void) | null
  onend: (() => void) | null
  onerror: ((ev: { error: string }) => void) | null
  start: () => void
  stop: () => void
}

interface SpeechResultEvent {
  resultIndex: number
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
}

const INTERIM_THROTTLE_MS = 400

function detectRecognition(): (new () => SpeechRec) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRec
    webkitSpeechRecognition?: new () => SpeechRec
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function useDefenseMic(enabled: boolean, onFinal: (text: string) => void): DefenseMic {
  const [supported] = useState(() => detectRecognition() !== null)
  const [transcript, setTranscript] = useState('')
  const [listening, setListening] = useState(false)
  const [error, setError] = useState('')
  const recRef = useRef<SpeechRec | null>(null)
  const lastInterimAt = useRef(0)
  const onFinalRef = useRef(onFinal)
  onFinalRef.current = onFinal

  useEffect(() => {
    const Ctor = detectRecognition()
    if (!Ctor || !enabled) return

    setError('')
    const rec = new Ctor()
    rec.lang = 'ru-RU'
    rec.interimResults = true
    rec.continuous = true
    let micDead = false
    rec.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i]
        const text = res[0]?.transcript ?? ''
        if (!text.trim()) continue
        if (res.isFinal) {
          setTranscript(text)
          onFinalRef.current(text.trim())
        } else {
          const now = Date.now()
          if (now - lastInterimAt.current > INTERIM_THROTTLE_MS) {
            lastInterimAt.current = now
            setTranscript(text)
          }
        }
      }
    }
    // restart recognition while phase is active; fatal errors abort
    rec.onerror = (ev) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed' || ev.error === 'audio-capture' || ev.error === 'network') {
        setError(ev.error === 'network' ? 'Распознавание недоступно. Введите ответ текстом.' : 'Нет доступа к микрофону. Разрешите его в браузере или введите текст.')
        micDead = true
        setListening(false)
      }
    }
    rec.onend = () => {
      if (enabled && !micDead) {
        try {
          rec.start()
        } catch {
          /* already started */
        }
      }
    }
    recRef.current = rec
    try {
      rec.start()
      setListening(true)
    } catch {
      /* no mic permission */
    }
    return () => {
      rec.onend = null
      try {
        rec.stop()
      } catch {
        /* noop */
      }
      recRef.current = null
      setListening(false)
    }
  }, [enabled])

  const start = useCallback(() => {
    try {
      recRef.current?.start()
      setListening(true)
    } catch {
      /* already running */
    }
  }, [])

  const stop = useCallback(() => {
    try {
      recRef.current?.stop()
    } catch {
      /* already stopped */
    }
    setListening(false)
  }, [])

  return { supported, listening, transcript, start, stop, error }
}
