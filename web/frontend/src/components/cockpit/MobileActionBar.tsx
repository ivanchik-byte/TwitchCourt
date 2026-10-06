import { Gavel } from 'lucide-react'
import { useTribunalActions } from '../../tribunal/TribunalContext'
import { useBan, usePunishWithToast } from './usePunish'

export function MobileActionBar() {
  const { gavel } = useTribunalActions()
  const ban = useBan()
  const punishToast = usePunishWithToast()

  return (
    <div className="sticky bottom-0 z-10 -mx-3 mt-1 border-t border-white/10 bg-black/85 px-3 py-2 backdrop-blur-md lg:hidden">
      <div className="flex gap-1.5">
        <button
          onClick={gavel}
          aria-label="Удар молотком"
          className="pressable flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/15 px-2 py-2.5 font-bold text-amber-200"
        >
          <Gavel size={16} /> <span className="keycap">Space</span>
        </button>
        <button
          onClick={() => void punishToast('pardon')}
          aria-label="Помиловать (1)"
          className="pressable rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-2.5 text-sm"
        >
          1
        </button>
        <button
          onClick={() => void punishToast('timeout', 60)}
          aria-label="Тайм-аут 60 секунд (2)"
          className="pressable rounded-lg border border-white/10 bg-white/5 px-2.5 py-2.5 text-sm"
        >
          60с
        </button>
        <button
          onClick={() => void punishToast('timeout', 300)}
          aria-label="Тайм-аут 5 минут (3)"
          className="pressable rounded-lg border border-white/10 bg-white/5 px-2.5 py-2.5 text-sm"
        >
          5м
        </button>
        <button
          onClick={() => void ban()}
          aria-label="Блокировка на канале (4)"
          className="pressable rounded-lg border border-red-400/30 bg-red-400/10 px-2.5 py-2.5 text-sm"
        >
          Бан
        </button>
      </div>
    </div>
  )
}
