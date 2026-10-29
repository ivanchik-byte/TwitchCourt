import { memo } from 'react'
import { HelpTip } from '../../components/HelpTip'
import { apiPut } from '../../lib/api'
import { inputCls, labelCls, lines, saveSection, SaveButton, type ProfileState } from './shared'

interface Props {
  profile: ProfileState
  setProfile: (v: ProfileState) => void
}

export const ProfileSection = memo(function ProfileSection({ profile, setProfile }: Props) {
  return (
    <section className="card space-y-2 p-4">
      <h2 className="font-semibold">Профиль стримера</h2><div className="settings-callout"><strong>Дайте суду пару точных зацепок</strong><p>Например: «обещает последнюю катку», «винит настройки мыши». Это контекст для реплик, а не обязательный сценарий. Случайные длинные списки чаще мешают.</p></div>
      <label className={labelCls}>
        Имя в памяти суда <HelpTip label="Имя в памяти">Имя в профиле, которое получает модель как контекст. Имя подсудимого в суде над стримером задаётся в блоке «Имя в делах» ниже.</HelpTip>
        <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} className={inputCls} />
      </label>
      <label className={labelCls}>
        Милосердие судьи <HelpTip label="Милосердие">Текстовое описание склонности к снисхождению. Это подсказка модели, а не процент оправданий и не гарантия результата.</HelpTip>
        <input value={profile.mercy} onChange={(e) => setProfile({ ...profile, mercy: e.target.value })} placeholder="строг, но справедлив" className={inputCls} />
      </label>
      <div className="grid grid-cols-2 gap-1.5">
        <label className={labelCls}>
          Титулы (по строке)
          <textarea value={profile.titles} onChange={(e) => setProfile({ ...profile, titles: e.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-sm text-white outline-none" />
        </label>
        <label className={labelCls}>
          Черты характера (по строке)
          <textarea value={profile.traits} onChange={(e) => setProfile({ ...profile, traits: e.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-sm text-white outline-none" />
        </label>
        <label className={labelCls}>
          Коронные фразы (по строке)
          <textarea value={profile.gags} onChange={(e) => setProfile({ ...profile, gags: e.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-sm text-white outline-none" />
        </label>
        <label className={labelCls}>
          Память о прошлых делах <HelpTip label="Память суда">Контекст, который передаётся модели вместе с профилем. Удалите неверные или устаревшие факты. Это влияет на упоминания в репликах, но не меняет уже вынесенные решения.</HelpTip>
          <textarea value={profile.notes} onChange={(e) => setProfile({ ...profile, notes: e.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-sm text-white outline-none" />
        </label>
      </div>
      <div>
        <SaveButton
          onSave={() =>
            saveSection('Профиль', () =>
              apiPut('/api/profile', {
                name: profile.name,
                mercy: profile.mercy,
                titles: lines(profile.titles),
                traits: lines(profile.traits),
                running_gags: lines(profile.gags),
                auto_notes: lines(profile.notes),
              })
            )
          }
        />
      </div>
    </section>
  )
})
