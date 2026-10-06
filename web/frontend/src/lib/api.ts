export function getSecret(): string {
  return localStorage.getItem('tribunal-secret') ?? ''
}

export function setSecret(secret: string) {
  if (secret) localStorage.setItem('tribunal-secret', secret)
  else localStorage.removeItem('tribunal-secret')
}

export interface ApiResult {
  ok: boolean
  status: number
}

export function apiNote(status: number): string {
  if (status === 401) return 'проверьте секретный ключ'
  if (status === 409) return 'зал занят, дождитесь окончания текущего дела'
  if (status === 429) return 'превышен лимит запросов, повторите позже'
  if (status === 502) return 'внешний сервис недоступен'
  if (status === 0) return 'нет соединения с сервером'
  return `ошибка ${status}`
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  const secret = getSecret()
  if (secret) headers.set('X-Tribunal-Secret', secret)
  const res = await fetch(path, { ...init, headers })
  return res
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await apiFetch(path)
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return res.json() as Promise<T>
}

async function call(path: string, method: string, body: unknown): Promise<ApiResult> {
  try {
    const res = await apiFetch(path, { method, body: JSON.stringify(body) })
    return { ok: res.ok, status: res.status }
  } catch {
    return { ok: false, status: 0 }
  }
}

export function apiPost(path: string, body: unknown): Promise<ApiResult> {
  return call(path, 'POST', body)
}

export async function apiPostJson<T>(path: string, body: unknown): Promise<{ ok: boolean; status: number; data?: T }> {
  try {
    const res = await apiFetch(path, { method: 'POST', body: JSON.stringify(body) })
    if (!res.ok) return { ok: false, status: res.status }
    return { ok: true, status: res.status, data: (await res.json()) as T }
  } catch {
    return { ok: false, status: 0 }
  }
}

export function apiPut(path: string, body: unknown): Promise<ApiResult> {
  return call(path, 'PUT', body)
}

export async function apiUpload(path: string, form: FormData): Promise<boolean> {
  const headers = new Headers()
  const secret = getSecret()
  if (secret) headers.set('X-Tribunal-Secret', secret)
  try {
    const res = await fetch(path, { method: 'POST', headers, body: form })
    return res.ok
  } catch {
    return false
  }
}
