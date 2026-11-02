import { useEffect } from 'react'

const liveDrafts = new Map<string, unknown>()

export function readDraft<T>(key: string): T | null {
  if (liveDrafts.has(key)) return liveDrafts.get(key) as T
  try { return JSON.parse(sessionStorage.getItem(key) || 'null') as T | null }
  catch { return null }
}

export function writeDraft(key: string, value: unknown) {
  liveDrafts.set(key, value)
  try { sessionStorage.setItem(key, JSON.stringify(value)) }
  catch { /* Memory still preserves the draft across routes if storage is full. */ }
}

export function removeDraft(key: string) {
  liveDrafts.set(key, null)
  try { sessionStorage.removeItem(key) }
  catch { /* Storage can be unavailable in embedded browsers. */ }
}

export function useDraftWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
}
