import { Mic } from 'lucide-react'
import { useAudioMeter } from '../../hooks/useAudioMeter'
import { useDefenseMic } from '../../hooks/useDefenseMic'
import { useTribunalState } from '../../tribunal/TribunalContext'

export function LawyerMic() {
  const t = useTribunalState()
  const defenseLive = t.phase === 'defense' || t.phase === 'testimony'
  const { canvasRef } = useAudioMeter(defenseLive)
  const { transcript, listening, supported } = useDefenseMic(defenseLive, (text) => {
    t.send('defense', { author: 'стример', text })
  })

  return (
    <section className="shrink-0 rounded-lg border border-white/10 bg-black/30 p-2.5" aria-label="Микрофон адвоката">
      <div className="mb-1.5 flex items-center gap-2 text-xs text-zinc-400">
        <Mic size={13} className={listening ? 'text-emerald-300' : ''} />
        {listening ? 'Адвокат в эфире' : 'Микрофон адвоката'}
        {!supported && <span className="text-zinc-600">· браузер без Web Speech API</span>}
      </div>
      <canvas ref={canvasRef} width={480} height={26} className="h-[26px] w-full rounded bg-black/50" />
      <p className="mt-1 min-h-[1.25rem] truncate font-mono text-xs text-cyan-200">{transcript || '—'}</p>
      {t.judgeLine && <p className="mt-1 text-sm text-amber-100/90">{t.judgeLine}</p>}
    </section>
  )
}
