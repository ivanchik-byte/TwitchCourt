import { Gavel } from 'lucide-react'
import { toast } from 'sonner'
import { useTribunal } from '../../tribunal/TribunalContext'

export function MobileActionBar() {
  const { gavel, punish } = useTribunal()

  const ban = async () => {
    const ok = await punish('ban')
    if (!ok) {
      toast.error('Не вышло — проверь секретный ключ')
      return
    }
    toast('Бан выдан', {
      duration: 5000,
      action: { label: 'Отмена', onClick: () => void punish('pardon') },
    })
  }

  return (
    <div className="sticky bottom-0 z-10 -mx-3 mt-1 border-t border-white/10 bg-black/85 px-3 py-2 backdrop-blur-md lg:hidden">
      <div className="flex gap-1.5">
        <button
          onClick={gavel}
          aria-label="Ударить молотком"
          className="pressable flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/15 px-2 py-2.5 font-bold text-amber-200"
        >
          <Gavel size={16} /> <span className="keycap">Space</span>
        </button>
        <button
          onClick={() => void punish('pardon')}
          className="pressable rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-2.5 text-sm"
        >
          1
        </button>
        <button
          onClick={() => void punish('timeout', 60)}
          className="pressable rounded-lg border border-white/10 bg-white/5 px-2.5 py-2.5 text-sm"
        >
          60с
        </button>
        <button
          onClick={() => void punish('timeout', 300)}
          className="pressable rounded-lg border border-white/10 bg-white/5 px-2.5 py-2.5 text-sm"
        >
          5м
        </button>
        <button
          onClick={() => void ban()}
          className="pressable rounded-lg border border-red-400/30 bg-red-400/10 px-2.5 py-2.5 text-sm"
        >
          Бан
        </button>
      </div>
    </div>
  )
}
