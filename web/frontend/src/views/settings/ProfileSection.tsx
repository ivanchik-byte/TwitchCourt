import { memo } from 'react'
import { apiPut } from '../../lib/api'
import { inputCls, labelCls, lines, saveSection, SaveButton, type ProfileState } from './shared'

interface Props {
  profile: ProfileState
  setProfile: (v: ProfileState) => void
}

export const ProfileSection = memo(function ProfileSection({ profile, setProfile }: Props) {
  return (
    <section className="card space-y-2 p-4">
      <h2 className="font-semibold">Профиль стримера и характер судьи</h2>
      <label className={labelCls}>
        Имя стримера
        <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} className={inputCls} />
      </label>
      <label className={labelCls}>
        Милосердие судьи
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
          Автозаметки (по строке)
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
