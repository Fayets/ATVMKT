import { createClient } from '@/lib/supabase/client'
import { NextResponse } from 'next/server'
import {
  verifyFathomWebhook,
  isTimestampValid,
  getExternalEmail,
  getCallDate,
  getFathomTranscript,
  type FathomWebhookPayload,
} from '@/features/leads/services/fathom-service'
import { analyzeTranscript } from '@/features/leads/services/fathom-transcript-analyzer'

// Hardcoded fallbacks (same pattern as Calendly webhook)
const FALLBACK_WEBHOOK_SECRET = 'whsec_xiN17sPevK2D7Vja6mFOx1fCamo1NZq0'
const FALLBACK_CALENDLY_TOKEN = 'cal_wh_8f3a2b9d7e1c4056a9d2e8f7b3c1a5d4'
const FALLBACK_FATHOM_API_KEY = 'ffOfFvEQn1xVH-umy__wHw.jeULAda2DYOgLgrrf-LcUYCbfgpp5DnXHRhMpzGT0WU'

async function getFathomCredentials() {
  try {
    const supabase = createClient()
    const { data: fathom } = await supabase.from('api_connections').select('credentials').eq('platform', 'fathom').limit(1).single()
    const { data: calendly } = await supabase.from('api_connections').select('credentials').eq('platform', 'calendly').limit(1).single()
    return {
      webhookSecret:
        process.env.FATHOM_WEBHOOK_SECRET ||
        (fathom?.credentials?.webhook_secret as string) ||
        FALLBACK_WEBHOOK_SECRET,
      calendlyToken:
        process.env.CALENDLY_WEBHOOK_TOKEN ||
        (calendly?.credentials?.webhook_token as string) ||
        FALLBACK_CALENDLY_TOKEN,
      fathomApiKey:
        process.env.FATHOM_API_KEY ||
        (fathom?.credentials?.api_key as string) ||
        FALLBACK_FATHOM_API_KEY,
    }
  } catch {
    return {
      webhookSecret: process.env.FATHOM_WEBHOOK_SECRET || FALLBACK_WEBHOOK_SECRET,
      calendlyToken: process.env.CALENDLY_WEBHOOK_TOKEN || FALLBACK_CALENDLY_TOKEN,
      fathomApiKey: process.env.FATHOM_API_KEY || FALLBACK_FATHOM_API_KEY,
    }
  }
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text()
    const webhookId = request.headers.get('webhook-id') || ''
    const webhookTimestamp = request.headers.get('webhook-timestamp') || ''
    const webhookSignature = request.headers.get('webhook-signature') || ''

    const creds = await getFathomCredentials()

    // Verificar firma si hay headers de webhook
    if (webhookId && webhookTimestamp && webhookSignature) {
      if (!isTimestampValid(webhookTimestamp)) {
        return NextResponse.json({ error: 'Timestamp too old' }, { status: 401 })
      }
      if (
        creds.webhookSecret &&
        !verifyFathomWebhook(rawBody, webhookId, webhookTimestamp, webhookSignature, creds.webhookSecret)
      ) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    }

    const payload: FathomWebhookPayload = JSON.parse(rawBody)

    if (!payload.url && !payload.share_url) {
      return NextResponse.json({ error: 'Invalid Fathom payload' }, { status: 400 })
    }

    const supabase = createClient()

    const email = getExternalEmail(payload)
    const callDate = getCallDate(payload)
    const callLink = payload.share_url || payload.url

    console.log('[Fathom] email:', email, 'date:', callDate, 'link:', callLink)

    // Step 1: Update call_link via RPC
    const { data: matchData, error: matchError } = await supabase.rpc('update_lead_fathom', {
      p_webhook_token: creds.calendlyToken,
      p_email: email,
      p_call_date: callDate,
      p_call_link: callLink,
      p_closer_report: null,
      p_dolores_llamada: null,
      p_razon_compra: null,
      p_program_offered: null,
      p_program_purchased: null,
      p_status: null,
    })

    console.log('[Fathom] RPC1 result:', JSON.stringify(matchData), 'error:', JSON.stringify(matchError))

    if (matchError || matchData?.warning || matchData?.error) {
      return NextResponse.json({ success: false, error: matchError?.message, ...matchData }, { status: 200 })
    }

    // Step 2: Get transcript
    let transcript = ''
    if (payload.transcript?.length) {
      transcript = payload.transcript
        .map(t => `${t.speaker_name}: ${t.text}`)
        .join('\n')
    } else {
      try {
        transcript = await getFathomTranscript(payload.url, creds.fathomApiKey)
      } catch {
        return NextResponse.json({ success: true, lead_id: matchData?.lead_id, action: 'link_updated_no_transcript' })
      }
    }

    // Step 3: Analyze with AI and update lead
    if (transcript) {
      const analysis = await analyzeTranscript(transcript)
      console.log('[Fathom] Analysis status:', analysis.status)

      const { data: updateData, error: updateError } = await supabase.rpc('update_lead_fathom', {
        p_webhook_token: creds.calendlyToken,
        p_email: email,
        p_call_date: callDate,
        p_call_link: callLink,
        p_closer_report: analysis.closer_report,
        p_dolores_llamada: analysis.dolores_llamada,
        p_razon_compra: analysis.razon_compra,
        p_program_offered: analysis.program_offered,
        p_program_purchased: analysis.program_purchased,
        p_status: analysis.status,
      })

      console.log('[Fathom] RPC2 result:', JSON.stringify(updateData), 'error:', JSON.stringify(updateError))
    }

    return NextResponse.json({ success: true, lead_id: matchData?.lead_id, action: 'fully_analyzed' })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'fathom-webhook' })
}
