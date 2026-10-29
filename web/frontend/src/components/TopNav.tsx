import { NavLink, Link } from 'react-router-dom'
import { Gavel, Radio, Layers, SlidersHorizontal, Monitor } from 'lucide-react'
import { useState } from 'react'
import { useAppearance, type ConsoleTheme } from '../tribunal/AppearanceContext'
import { cn } from '../lib/cn'

const tabs = [
  { to: '/', label: 'Эфир', icon: Radio, end: true },
  { to: '/cases', label: 'Колода дел', icon: Layers, end: false },
  { to: '/settings', label: 'Настройки', icon: SlidersHorizontal, end: false },
  { to: '/obs', label: 'OBS', icon: Monitor, end: false },
]

export function TopNav({ wsOk, rtt }: { wsOk: boolean; rtt: number | null; retries?: number }) {
  const { appearance, save } = useAppearance()
  const [themeBusy, setThemeBusy] = useState(false)
  const [themeError, setThemeError] = useState('')
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
      <div className="header-appearance">
        <Link to="/settings?section=appearance">Оформление</Link>
        <select aria-label="Тема пульта" value={appearance?.theme ?? 'walnut'} disabled={!appearance || themeBusy} title={themeError || 'Тема пульта и сцены OBS'} onChange={async event => {
          if (!appearance) return
          setThemeBusy(true)
          setThemeError('')
          try { await save({ ...appearance, theme: event.target.value as ConsoleTheme }) }
          catch { setThemeError('Не удалось сменить тему. Проверьте связь с сервером.') }
          finally { setThemeBusy(false) }
        }}><option value="graphite">Графит</option><option value="slate">Ночной эфир</option><option value="walnut">Орех</option></select>
        {themeError && <span role="alert" className="header-theme-error">{themeError}</span>}
      </div>
      <div className="show-connection" role="status">
        <span className={cn('connection-dot', wsOk && 'is-connected')} />
        <span>{wsOk ? 'На связи' : 'Нет связи'}<small>{wsOk && rtt !== null ? `${rtt} мс` : 'Переподключение'}</small></span>
      </div>
    </header>
  )
}
