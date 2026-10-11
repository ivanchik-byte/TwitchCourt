import { useCallback, useEffect, useRef } from 'react'
import { Mic } from 'lucide-react'
import { useAudioMeter } from '../../hooks/useAudioMeter'
import { useDefenseMic } from '../../hooks/useDefenseMic'
import { apiPost } from '../../lib/api'
import { useTribunalActions, useTribunalFeed, useTribunalPhase } from '../../tribunal/TribunalContext'

export function LawyerMic() {
  const { phase } = useTribunalPhase()
  const { judgeLine } = useTribunalFeed()
  const { send } = useTribunalActions()
  const defenseLive = phase === 'defense' || phase === 'testimony'
  const { canvasRef } = useAudioMeter(defenseLive)
  const pendingRef = useRef<string[]>([])

  // dead socket must not eat the defense: REST fallback + backlog flush
  const submit = useCallback(
    async (text: string) => {
      const lines = [...pendingRef.current, text].slice(-20)
      pendingRef.current = []
      for (const line of lines) {
        if (send('defense', { author: 'стример', text: line })) continue
        const r = await apiPost('/api/defense', { author: 'стример', text: line })
        if (!r.ok) {
          pendingRef.current.push(line)
          break
        }
      }
    },
    [send],
  )

  useEffect(() => {
    if ((phase === 'defense' || phase === 'testimony') && pendingRef.current.length > 0) {
      const backlog = pendingRef.current
      pendingRef.current = []
      for (const line of backlog) void submit(line)
    }
  }, [phase, submit])

  const { transcript, listening, supported } = useDefenseMic(defenseLive, (text) => {
    void submit(text)
  })

  return (
    <section className="shrink-0 rounded-lg border border-white/10 bg-black/30 p-2.5" aria-label="Микрофон защиты">
      <div className="mb-1.5 flex items-center gap-2 text-xs text-zinc-400">
        <Mic size={13} className={listening ? 'text-emerald-300' : ''} />
        {listening ? 'Микрофон активен' : 'Микрофон защиты'}
        {!supported && <span className="text-zinc-600">(Web Speech API не поддерживается)</span>}
      </div>
      <canvas ref={canvasRef} width={480} height={26} className="h-[26px] w-full rounded bg-black/50" />
      <p className="mt-1 min-h-[1.25rem] truncate font-mono text-xs text-cyan-200">{transcript}</p>
      {judgeLine && <p className="mt-1 text-sm text-amber-100/90">{judgeLine}</p>}
    </section>
  )
}
