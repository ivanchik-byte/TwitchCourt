import { useEffect, useRef, useState } from 'react'

export function useAudioMeter(active: boolean) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [level, setLevel] = useState(0)

  useEffect(() => {
    if (!active) return
    let ctx: AudioContext | null = null
    let analyser: AnalyserNode | null = null
    let stream: MediaStream | null = null
    let raf = 0
    let cancelled = false

    const data = new Uint8Array(64)
    const draw = () => {
      const canvas = canvasRef.current
      if (!canvas) {
        raf = requestAnimationFrame(draw)
        return
      }
      const g = canvas.getContext('2d')
      if (!g || !analyser) {
        raf = requestAnimationFrame(draw)
        return
      }
      analyser.getByteTimeDomainData(data)
      let peak = 0
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i] - 128) / 128
        if (v > peak) peak = v
      }
      setLevel((prev) => prev * 0.7 + peak * 0.3)
      const segs = 24
      const w = canvas.width / segs
      g.clearRect(0, 0, canvas.width, canvas.height)
      for (let i = 0; i < segs; i++) {
        const on = peak * segs > i
        g.fillStyle = on ? (i > segs * 0.8 ? '#ef4444' : i > segs * 0.55 ? '#f59e0b' : '#10b981') : 'rgba(255,255,255,0.08)'
        g.fillRect(i * w + 1, 2, w - 2, canvas.height - 4)
      }
      if (!cancelled) raf = requestAnimationFrame(draw)
    }

    navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        ctx = new AudioContext()
        analyser = ctx.createAnalyser()
        analyser.fftSize = 128
        ctx.createMediaStreamSource(s).connect(analyser)
        raf = requestAnimationFrame(draw)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
      void ctx?.close()
    }
  }, [active])

  return { canvasRef, level }
}
