'use client'

import { z } from 'zod'

const loginSchema = z.object({
  username: z.string().min(1, 'Usuario requerido'),
  password: z.string().min(6, 'Minimo 6 caracteres'),
})

export type AuthResult = {
  error?: string
  ok?: boolean
}

const BACKEND_BASE =
  (process.env.NEXT_PUBLIC_BACKEND_URL || '').trim().replace(/\/$/, '') || '/api-backend'

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    return JSON.parse(atob(padded)) as Record<string, unknown>
  } catch {
    return null
  }
}

function persistSession(token: string) {
  if (typeof window === 'undefined') return
  const payload = decodeJwtPayload(token)
  const sub = payload?.sub
  const userId = typeof sub === 'string' ? sub : ''
  sessionStorage.setItem('access_token', token)
  sessionStorage.setItem('evoluciona_token', token)
  sessionStorage.setItem('auth_token', token)
  if (userId) {
    sessionStorage.setItem('user_id', userId)
    sessionStorage.setItem('evoluciona_user_id', userId)
  }
}

export async function login(username: string, password: string): Promise<AuthResult> {
  const parsed = loginSchema.safeParse({ username, password })

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const response = await fetch(`${BACKEND_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parsed.data),
  })
  const data = (await response.json().catch(() => null)) as { detail?: string; access_token?: string } | null

  if (!response.ok) {
    return { error: data?.detail || 'No se pudo iniciar sesion' }
  }

  const token = data?.access_token
  if (!token) return { error: 'Respuesta invalida del servidor' }
  persistSession(token)
  return { ok: true }
}

export async function signup(): Promise<AuthResult> {
  return { error: 'Registro deshabilitado. Crear usuarios desde Swagger /auth/register.' }
}

export async function logout() {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem('access_token')
    sessionStorage.removeItem('evoluciona_token')
    sessionStorage.removeItem('token')
    sessionStorage.removeItem('auth_token')
    sessionStorage.removeItem('user_id')
    sessionStorage.removeItem('evoluciona_user_id')
    sessionStorage.removeItem('auth_user_id')
  }
}
