import { useEffect, useRef, useState } from 'react'

interface DefenseMic {
  supported: boolean
  listening: boolean
  transcript: string
  start: () => void
  stop: () => void
}

export function useDefenseMic(enabled: boolean, onFinal: (text: string) => void): DefenseMic {
  const [transcript, setTranscript] = useState('')
  const [listening, setListening] = useState(false)
  const recRef = useRef<{ stop: () => void; start: () => void } | null>(null)
  const onFinalRef = useRef(onFinal)
  onFinalRef.current = onFinal

  useEffect(() => {
    const SR = (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
    if (!SR || !enabled) return

    const Rec = SR as new () => {
      lang: string
      interimResults: boolean
      continuous: boolean
      onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
      onend: (() => void) | null
      start: () => void
      stop: () => void
    }
    const rec = new Rec()
    rec.lang = 'ru-RU'
    rec.interimResults = true
    rec.continuous = true
    rec.onresult = (ev) => {
      const last = ev.results[ev.results.length - 1]?.[0]?.transcript ?? ''
      setTranscript(last)
      if (last.trim()) onFinalRef.current(last.trim())
    }
    // chrome sleeps recognition — restart while defense phase is live
    rec.onend = () => {
      if (enabled) {
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
      setListening(false)
    }
  }, [enabled])

  return {
    supported: true,
    listening,
    transcript,
    start: () => undefined,
    stop: () => undefined,
  }
}
