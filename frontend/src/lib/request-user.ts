import { NextResponse } from 'next/server'
import { getBackendInternalUrl } from '@/shared/lib/backend-internal-url'

/**
 * Identidad del request en las rutas server-side de Next.
 *
 * Antes se leía el header `X-User-Id` y se confiaba en él: cualquiera lo mandaba
 * y usaba estas rutas (ManyChat, Claude, YouTube) con las claves del servidor.
 * Ahora el Bearer token se valida contra el backend, que es quien lo firmó.
 */
export async function requireNumericUserId(request: Request): Promise<string | NextResponse> {
  const unauthorized = NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const authorization = request.headers.get('authorization')?.trim()
  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) return unauthorized

  try {
    const res = await fetch(`${getBackendInternalUrl()}/auth/me`, {
      headers: { Authorization: authorization },
      cache: 'no-store',
    })
    if (!res.ok) return unauthorized

    const data = (await res.json()) as { user_id?: number } | null
    const uid = data?.user_id
    if (typeof uid !== 'number' || !Number.isFinite(uid)) return unauthorized
    return String(uid)
  } catch {
    return NextResponse.json({ error: 'Auth backend unreachable' }, { status: 503 })
  }
}
