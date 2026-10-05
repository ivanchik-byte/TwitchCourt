import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'sonner'
import { TopNav } from './components/TopNav'
import { CockpitView } from './views/CockpitView'
import { useTribunalWS } from './hooks/useTribunalWS'

const ModesView = lazy(() => import('./views/ModesView').then((m) => ({ default: m.ModesView })))
const SettingsView = lazy(() => import('./views/SettingsView').then((m) => ({ default: m.SettingsView })))

export function App() {
  const t = useTribunalWS()

  return (
    <BrowserRouter>
      <div className="min-h-[100dvh]">
        <TopNav wsOk={t.connected} rtt={t.rttMs} />
        <Suspense fallback={<p className="p-4 text-sm text-zinc-500">Загрузка…</p>}>
          <Routes>
            <Route path="/" element={<CockpitView t={t} />} />
            <Route path="/modes" element={<ModesView />} />
            <Route path="/settings" element={<SettingsView />} />
          </Routes>
        </Suspense>
        <Toaster theme="dark" position="bottom-right" />
      </div>
    </BrowserRouter>
  )
}
