import { NextResponse } from 'next/server'

/** POST /api/webhooks/manychat — eventos ManyChat (validación básica; lógica de negocio en backend si aplica). */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const payload = body as Record<string, unknown>
    const queryToken = new URL(request.url).searchParams.get('token')?.trim() || ''
    const headerToken = String(request.headers.get('X-Webhook-Token') || '').trim()
    const bodyToken = String(payload.webhook_token || '').trim()
    const webhookToken = queryToken || headerToken || bodyToken
    if (webhookToken) payload.webhook_token = webhookToken

    const event = String(payload.event || '').trim().toLowerCase()
    let keyword = String(payload.keyword || '').trim()
    if (!keyword && event === 'respondio_auto') {
      keyword = 'respondio_auto'
    }

    if (!webhookToken) {
      return NextResponse.json({ error: 'Missing webhook_token' }, { status: 401 })
    }
    if (!keyword) {
      return NextResponse.json({ error: 'Missing keyword' }, { status: 400 })
    }

    return NextResponse.json({ success: true, chat_id: null })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'manychat-webhook' })
}
