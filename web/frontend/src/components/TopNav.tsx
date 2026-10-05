import { NavLink } from 'react-router-dom'
import { Gavel, SlidersHorizontal, Settings } from 'lucide-react'
import { cn } from '../lib/cn'

const tabs = [
  { to: '/', label: 'Пульт', icon: Gavel, end: true },
  { to: '/modes', label: 'Режимы', icon: SlidersHorizontal, end: false },
  { to: '/settings', label: 'Настройки', icon: Settings, end: false },
]

export function TopNav({ wsOk, rtt }: { wsOk: boolean; rtt: number | null }) {
  return (
    <nav className="sticky top-0 z-20 border-b border-white/10 bg-black/70 backdrop-blur-md">
      <div className="mx-auto flex h-12 max-w-[1600px] items-center gap-2 px-3">
        <span className="font-mono text-xs tracking-widest text-amber-400">TRIBUNAL</span>
        <div className="flex gap-1">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm',
                  isActive ? 'bg-white/10 text-white' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200',
                )
              }
            >
              <t.icon size={15} />
              {t.label}
            </NavLink>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 font-mono text-xs">
          <span className={cn('inline-block h-2 w-2 rounded-full', wsOk ? 'bg-emerald-400' : 'bg-red-500')} />
          <span className="text-zinc-400">{wsOk ? `live${rtt != null ? ` · ${rtt}ms` : ''}` : 'offline · retry 2s'}</span>
        </div>
      </div>
    </nav>
  )
}
