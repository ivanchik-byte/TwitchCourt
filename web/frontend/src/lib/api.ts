export function getSecret(): string {
  return localStorage.getItem('tribunal-secret') ?? ''
}

export function setSecret(secret: string) {
  if (secret) localStorage.setItem('tribunal-secret', secret)
  else localStorage.removeItem('tribunal-secret')
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

export async function apiPost(path: string, body: unknown): Promise<boolean> {
  const res = await apiFetch(path, { method: 'POST', body: JSON.stringify(body) })
  return res.ok
}

export async function apiPut(path: string, body: unknown): Promise<boolean> {
  const res = await apiFetch(path, { method: 'PUT', body: JSON.stringify(body) })
  return res.ok
}

export async function apiUpload(path: string, form: FormData): Promise<boolean> {
  const headers = new Headers()
  const secret = getSecret()
  if (secret) headers.set('X-Tribunal-Secret', secret)
  const res = await fetch(path, { method: 'POST', headers, body: form })
  return res.ok
}
