import { NavLink } from 'react-router-dom'
import { Gavel, Radio, Layers, SlidersHorizontal, Monitor } from 'lucide-react'
import { cn } from '../lib/cn'

const tabs = [
  { to: '/', label: 'Эфир', icon: Radio, end: true },
  { to: '/cases', label: 'Колода дел', icon: Layers, end: false },
  { to: '/settings', label: 'Подготовка', icon: SlidersHorizontal, end: false },
  { to: '/obs', label: 'OBS', icon: Monitor, end: false },
]

export function TopNav({ wsOk, rtt }: { wsOk: boolean; rtt: number | null; retries?: number }) {
  return (
    <header className="show-header">
      <div className="show-brand"><Gavel size={20} strokeWidth={1.4} /><span>TRIBUNAL<small>СУД ПРЯМОГО ЭФИРА</small></span></div>
      <nav aria-label="Навигация" className="show-nav">
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => cn('show-nav-link', isActive && 'is-active')}>
            <Icon size={16} strokeWidth={1.5} /><span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="show-connection" role="status">
        <span className={cn('connection-dot', wsOk && 'is-connected')} />
        <span>{wsOk ? 'На связи' : 'Нет связи'}<small>{wsOk && rtt !== null ? `${rtt} мс` : 'Переподключение'}</small></span>
      </div>
    </header>
  )
}
