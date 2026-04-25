const API_BASE =
  (process.env.NEXT_PUBLIC_BACKEND_URL || '').trim().replace(/\/$/, '') || '/api-backend'

function readSessionToken(): string | null {
  if (typeof window === 'undefined') return null
  return (
    sessionStorage.getItem('evoluciona_token') ||
    sessionStorage.getItem('access_token') ||
    sessionStorage.getItem('token') ||
    sessionStorage.getItem('auth_token')
  )
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const decoded = atob(padded)
    return JSON.parse(decoded) as Record<string, unknown>
  } catch {
    return null
  }
}

function readUserIdFromSession(token: string | null): string | null {
  if (typeof window === 'undefined') return null
  const fromSession =
    sessionStorage.getItem('evoluciona_user_id') ||
    sessionStorage.getItem('user_id') ||
    sessionStorage.getItem('auth_user_id')
  if (fromSession) return fromSession
  if (!token) return null
  const payload = decodeJwtPayload(token)
  const candidate = payload?.sub ?? payload?.user_id ?? payload?.uid
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = readSessionToken()
  const userId = readUserIdFromSession(token)
  const headers = new Headers(init?.headers || {})
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  if (userId && !headers.has('X-User-Id')) {
    headers.set('X-User-Id', userId)
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const url = `${API_BASE}/api${normalizedPath}`
  return fetch(url, { ...init, headers })
}

