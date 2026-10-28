import { memo } from 'react'
import { apiPut } from '../../lib/api'
import { labelCls, lines, saveSection, SaveButton, type SafetyState } from './shared'

interface Props {
  safety: SafetyState
  setSafety: (v: SafetyState) => void
}

export const SafetySection = memo(function SafetySection({ safety, setSafety }: Props) {
  return (
    <section className="card space-y-2 p-4">
      <h2 className="font-semibold">Безопасность</h2>
      <label className="flex items-center gap-1.5 text-xs text-zinc-300">
        <input
          type="checkbox"
          checked={safety.filterEnabled}
          onChange={(e) => setSafety({ ...safety, filterEnabled: e.target.checked })}
        />
        Фильтр токсичности в суде
      </label>
      <label className="flex items-center gap-1.5 text-xs text-zinc-300">
        <input
          type="checkbox"
          checked={safety.banConfirm}
          onChange={(e) => setSafety({ ...safety, banConfirm: e.target.checked })}
        />
        Блокировки и таймауты только вручную
      </label>
      <label className={labelCls}>
        Чёрный список (по строке)
        <textarea
          value={safety.blacklist} onChange={(e) => setSafety({ ...safety, blacklist: e.target.value })}
          rows={3}
          className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-sm text-white outline-none"
        />
      </label>
      <label className={labelCls}>
        Хоткей паники
        <select
          value={safety.panicHotkey}
          onChange={(e) => setSafety({ ...safety, panicHotkey: e.target.value })}
          className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/40 px-2 text-sm text-white"
        >
          <option value="escape">Escape</option>
          <option value="f9">F9</option>
          <option value="f12">F12</option>
          <option value="p">P</option>
        </select>
      </label>
      <div>
        <SaveButton
          onSave={() =>
            saveSection('Безопасность', () =>
              apiPut('/api/safety', {
                filter_enabled: safety.filterEnabled,
                custom_blacklist: lines(safety.blacklist),
                panic_hotkey: safety.panicHotkey,
                ban_confirm: safety.banConfirm,
              })
            )
          }
        />
      </div>
    </section>
  )
})
