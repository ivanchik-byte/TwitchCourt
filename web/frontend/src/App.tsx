import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom'
import { Toaster } from 'sonner'
import { TopNav } from './components/TopNav'
import { TribunalProvider, useTribunalPhase } from './tribunal/TribunalContext'
import { CockpitView } from './views/CockpitView'
import { AppearanceProvider } from './tribunal/AppearanceContext'

const CasesView = lazy(() => import('./views/CasesView').then((m) => ({ default: m.CasesView })))
const SettingsView = lazy(() => import('./views/SettingsView').then((m) => ({ default: m.SettingsView })))
const OBSRemoteView = lazy(() => import('./views/OBSRemoteView').then((m) => ({ default: m.OBSRemoteView })))

function Shell() {
  const t = useTribunalPhase()

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <TopNav wsOk={t.connected} rtt={t.rttMs} retries={t.retries} />
      <main className="min-h-0 flex-1">
        <Suspense fallback={<p className="p-4 text-sm text-zinc-500">Загрузка…</p>}>
          <Routes>
            <Route path="/" element={<CockpitView />} />
            <Route path="/cases" element={<CasesView />} />
            <Route path="/modes" element={<Navigate to="/settings?section=rules" replace />} />
            <Route path="/obs" element={<OBSRemoteView />} />
            <Route path="/settings" element={<SettingsView />} />
            <Route path="*" element={<Navigate to="/" replace />} />
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
      <AppearanceProvider>
        <TribunalProvider>
          <Shell />
        </TribunalProvider>
      </AppearanceProvider>
    </BrowserRouter>
  )
}
