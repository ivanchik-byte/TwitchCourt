import { useHotkeys } from '../hooks/useHotkeys'
import { useTribunalActions } from '../tribunal/TribunalContext'
import { BenchQueue } from '../components/cockpit/BenchQueue'
import { GavelStage } from '../components/cockpit/GavelStage'
import { LawyerMic } from '../components/cockpit/LawyerMic'
import { StenogramLog } from '../components/cockpit/StenogramLog'
import { PunishmentMatrix } from '../components/cockpit/PunishmentMatrix'
import { MobileActionBar } from '../components/cockpit/MobileActionBar'

export function CockpitView() {
  const { gavel, punish, pick, skip, panic } = useTribunalActions()

  useHotkeys({
    onGavel: gavel,
    onPardon: () => void punish('pardon'),
    onMute60: () => void punish('timeout', 60),
    onMute300: () => void punish('timeout', 300),
    onBan: () => void punish('ban'),
    onRandom: () => void pick(),
    onSkip: () => void skip(),
    onPanic: panic,
  })

  return (
    <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-3 p-3 lg:h-[calc(100dvh-3rem)] lg:grid-cols-[300px_minmax(0,1fr)_320px] lg:overflow-hidden">
      <div className="order-3 flex min-h-0 flex-col lg:order-1 lg:overflow-hidden">
        <BenchQueue />
      </div>
      <div className="order-1 flex min-h-0 flex-col gap-3 lg:order-2 lg:overflow-hidden">
        <GavelStage />
        <LawyerMic />
        <StenogramLog />
      </div>
      <div className="order-2 flex min-h-0 flex-col lg:order-3 lg:overflow-hidden">
        <PunishmentMatrix />
      </div>
      <MobileActionBar />
    </div>
  )
}
