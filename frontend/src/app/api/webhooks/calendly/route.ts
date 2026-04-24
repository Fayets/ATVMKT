import { createClient } from '@/lib/supabase/client'
import { NextResponse } from 'next/server'
import {
  mapCalendlyToLead,
  getEmailFromPayload,
  isCreatedEvent,
  isCanceledEvent,
} from '@/features/leads/services/calendly-mapper'
import { enrichLeadFromManychat } from '@/features/leads/services/manychat-enricher'

// Buscar webhook_token de Calendly en BD. Fallback a env var para backwards compat.
async function getCalendlyToken() {
  try {
    const supabase = createClient()
    const { data } = await supabase.from('api_connections').select('credentials').eq('platform', 'calendly').limit(1).single()
    if (data?.credentials?.webhook_token) return data.credentials.webhook_token as string
  } catch { /* fallback */ }
  return process.env.CALENDLY_WEBHOOK_TOKEN || 'cal_wh_8f3a2b9d7e1c4056a9d2e8f7b3c1a5d4'
}

// POST /api/webhooks/calendly — Recibe eventos de Calendly y crea/actualiza leads
export async function POST(request: Request) {
  try {
    const body = await request.json()

    if (!body.event || !body.payload) {
      return NextResponse.json({ error: 'Invalid Calendly payload' }, { status: 400 })
    }

    const webhookToken = await getCalendlyToken()

    const supabase = createClient()

    // Evento: nueva agenda
    if (isCreatedEvent(body)) {
      const params = mapCalendlyToLead(body, webhookToken)

      const { data, error } = await supabase.rpc('log_calendly_lead', params)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      if (data?.error) {
        return NextResponse.json({ error: data.error }, { status: 401 })
      }

      // Enriquecer con datos de ManyChat (tolerante a fallos)
      try {
        const enrichment = await enrichLeadFromManychat(params.p_client_name, params.p_ig_handle, params.p_email)
        if (enrichment.ctas_responded > 0 || enrichment.first_contact_at) {
          await supabase.rpc('update_lead_manychat', {
            p_webhook_token: webhookToken,
            p_lead_id: data?.lead_id,
            p_entry_funnel: enrichment.entry_funnel,
            p_agenda_point: enrichment.agenda_point,
            p_first_contact_at: enrichment.first_contact_at,
            p_ctas_responded: enrichment.ctas_responded,
          })
        }
      } catch {
        // No fallar si ManyChat no responde
      }

      return NextResponse.json({ success: true, lead_id: data?.lead_id })
    }

    // Evento: cancelación
    if (isCanceledEvent(body)) {
      const email = getEmailFromPayload(body)

      const { error } = await supabase.rpc('cancel_calendly_lead', {
        p_webhook_token: webhookToken,
        p_email: email,
      })

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ success: true, action: 'canceled' })
    }

    return NextResponse.json({ success: true, action: 'ignored' })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}

// GET para verificar que el endpoint existe
export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'calendly-webhook' })
}
