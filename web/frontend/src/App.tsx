import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'sonner'
import { TopNav } from './components/TopNav'
import { TribunalProvider, useTribunal } from './tribunal/TribunalContext'
import { CockpitView } from './views/CockpitView'

const ModesView = lazy(() => import('./views/ModesView').then((m) => ({ default: m.ModesView })))
const SettingsView = lazy(() => import('./views/SettingsView').then((m) => ({ default: m.SettingsView })))
const OBSRemoteView = lazy(() => import('./views/OBSRemoteView').then((m) => ({ default: m.OBSRemoteView })))

function Shell() {
  const { t } = useTribunal()

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <TopNav wsOk={t.connected} rtt={t.rttMs} />
      <main className="min-h-0 flex-1">
        <Suspense fallback={<p className="p-4 text-sm text-zinc-500">Загрузка…</p>}>
          <Routes>
            <Route path="/" element={<CockpitView />} />
            <Route path="/modes" element={<ModesView />} />
            <Route path="/obs" element={<OBSRemoteView />} />
            <Route path="/settings" element={<SettingsView />} />
          </Routes>
        </Suspense>
      </main>
      <Toaster theme="dark" position="bottom-right" />
    </div>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <TribunalProvider>
        <Shell />
      </TribunalProvider>
    </BrowserRouter>
  )
}
