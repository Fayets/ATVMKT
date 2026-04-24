import { createClient } from '@/lib/supabase/client'
import { NextResponse } from 'next/server'

const BASE_ID_RE = /(app[a-zA-Z0-9]+)/i
const TABLE_ID_RE = /(tbl[a-zA-Z0-9]+)/i

/** Valor del campo "Vía" en Airtable para leads creados desde ManyChat. */
const AIRTABLE_VIA_MANYCHAT = "Automático - ManyChat"

function normalizeBaseId(raw: unknown): string {
  const s = String(raw || '').trim()
  if (!s) return ''
  const match = BASE_ID_RE.exec(s.replace(/\s+/g, ''))
  if (match) return match[1]
  return s.split('/')[0]?.split('?')[0]?.trim() || ''
}

function normalizeTableId(raw: unknown): string {
  const s = String(raw || '').trim()
  if (!s) return ''
  const match = TABLE_ID_RE.exec(s.replace(/\s+/g, ''))
  if (match) return match[1]
  if (s.toLowerCase().startsWith('tbl')) {
    return s.split('/')[0]?.split('?')[0]?.trim() || ''
  }
  return ''
}

function normalizeIgHandle(raw: unknown): string {
  const s = String(raw || '').trim().toLowerCase()
  if (!s) return ''
  if (s.includes('instagram.com/')) {
    const afterDomain = s.split('instagram.com/').pop() || ''
    const handle = afterDomain.split('/')[0]?.split('?')[0] || ''
    return handle.replace(/^@+/, '').replace(/[^a-z0-9._]/g, '')
  }
  return s.replace(/^@+/, '').replace(/[^a-z0-9._]/g, '')
}

// POST /api/webhooks/manychat — Recibe eventos de ManyChat y loguea chats
export async function POST(request: Request) {
  try {
    const body = await request.json()

    if (body?.event === 'respondio_auto') {
      const { webhook_token, contact_ig_username } = body
      if (!webhook_token || !contact_ig_username) {
        return NextResponse.json({ error: 'Missing webhook_token or contact_ig_username' }, { status: 400 })
      }

      const supabase = createClient()
      const { data, error } = await supabase.rpc('log_manychat_chat', {
        p_webhook_token: webhook_token,
        p_keyword: 'respondio_auto',
        p_contact_name: null,
        p_contact_ig_username: contact_ig_username || null,
        p_manychat_contact_id: null,
      })

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      if (data?.error) {
        return NextResponse.json({ error: data.error }, { status: 401 })
      }

      try {
        const atApiKey = (process.env.AIRTABLE_API_KEY || '').trim()
        const base_id = process.env.AIRTABLE_BASE_ID
        const table_name = process.env.AIRTABLE_LEADS_TABLE || 'Leads Marzo'
        const baseId = normalizeBaseId(base_id)
        const rawTable = String(table_name || '').trim() || 'Leads Marzo'
        const tableId = normalizeTableId(rawTable)
        const tableSegment = tableId || rawTable
        const igHandle = normalizeIgHandle(contact_ig_username)

        if (atApiKey && baseId && tableSegment && igHandle) {
          const basePath = encodeURIComponent(baseId)
          const tablePath = encodeURIComponent(tableSegment)
          const filterFormula = `SEARCH("${igHandle}",{IG})`
          const existsUrl = `https://api.airtable.com/v0/${basePath}/${tablePath}?maxRecords=1&filterByFormula=${encodeURIComponent(filterFormula)}`

          const existsRes = await fetch(existsUrl, {
            headers: {
              Authorization: `Bearer ${atApiKey}`,
              Accept: 'application/json',
            },
          })
          const checkBody = await existsRes.text()
          let records: { id?: string }[] = []
          if (existsRes.ok) {
            try {
              const existsData = checkBody ? JSON.parse(checkBody) : {}
              records = Array.isArray(existsData?.records) ? existsData.records : []
            } catch {
              records = []
            }
          } else {
            console.error('[respondio_auto] Airtable search failed:', existsRes.status, checkBody)
          }

          const recordId = records[0]?.id
          if (recordId) {
            const patchUrl = `https://api.airtable.com/v0/${basePath}/${tablePath}/${encodeURIComponent(recordId)}`
            const patchRes = await fetch(patchUrl, {
              method: 'PATCH',
              headers: {
                Authorization: `Bearer ${atApiKey}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
              },
              body: JSON.stringify({ fields: { 'Respondió auto': true } }),
            })
            const patchBody = await patchRes.text()
            if (!patchRes.ok) {
              console.error('[respondio_auto] Airtable PATCH failed:', patchRes.status, patchBody)
            }
          } else {
            console.log('[respondio_auto] Sin registro Airtable para IG handle:', igHandle)
          }
        }
      } catch (e) {
        console.error('respondio_auto Airtable update failed:', e)
      }

      return NextResponse.json({ success: true })
    }

    const {
      webhook_token,
      keyword,
      contact_name,
      contact_lastname,
      contact_ig_username,
      manychat_contact_id,
    } = body
    const fullName = [contact_name, contact_lastname].filter(Boolean).join(' ')

    if (!webhook_token || !keyword) {
      return NextResponse.json({ error: 'Missing webhook_token or keyword' }, { status: 400 })
    }

    // Usar supabase con anon key — la funcion RPC usa SECURITY DEFINER
    const supabase = createClient()

    const { data, error } = await supabase.rpc('log_manychat_chat', {
      p_webhook_token: webhook_token,
      p_keyword: keyword,
      p_contact_name: contact_name || null,
      p_contact_ig_username: contact_ig_username || null,
      p_manychat_contact_id: manychat_contact_id || null,
    })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (data?.error) {
      return NextResponse.json({ error: data.error }, { status: 401 })
    }

    // Cachear contacto en manychat_contacts para enriquecimiento de leads
    if (contact_ig_username && manychat_contact_id && !manychat_contact_id.includes('{{')) {
      try {
        // Leer API key de BD, fallback a env var
        const { data: mcConn } = await supabase.from('api_connections').select('credentials').eq('platform', 'manychat').limit(1).single()
        const mcApiKey =
          process.env.MANYCHAT_API_KEY?.trim() ||
          (mcConn?.credentials as Record<string, string>)?.api_key
        if (mcApiKey) {
          const subRes = await fetch(`https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=${manychat_contact_id}`, {
            headers: { 'Authorization': `Bearer ${mcApiKey}` },
          })
          if (subRes.ok) {
            const subData = await subRes.json()
            if (subData.status === 'success' && subData.data) {
              const tags = (subData.data.tags || []).map((t: { id: number; name: string }) => ({ id: t.id, name: t.name }))
              await supabase.from('manychat_contacts').upsert({
                ig_username: contact_ig_username.toLowerCase(),
                subscriber_id: manychat_contact_id,
                tags: JSON.stringify(tags),
                subscribed_at: subData.data.subscribed,
                updated_at: new Date().toISOString(),
              }, { onConflict: 'ig_username' })
            }
          }
        }
      } catch { /* no fallar si el cacheo falla */ }
    }

    // If tag_name is provided, increment chats on linked content_items
    const tag_name = body.tag_name || body.keyword
    if (tag_name) {
      try {
        await supabase.rpc('increment_content_chats_by_tag', { p_tag_name: tag_name })
      } catch { /* non-critical */ }
    }

    // Crear lead en Airtable (best effort, no romper webhook)
    if (contact_ig_username) {
      try {
        console.log('[Airtable] Iniciando creación de registro...')
        console.log('[Airtable] contact_ig_username:', contact_ig_username)
        const atApiKey = (process.env.AIRTABLE_API_KEY || '').trim()
        const base_id = process.env.AIRTABLE_BASE_ID
        const table_name = process.env.AIRTABLE_LEADS_TABLE || 'Leads Marzo'
        const baseId = normalizeBaseId(base_id)
        const rawTable = String(table_name || '').trim() || 'Leads Marzo'
        const tableId = normalizeTableId(rawTable)
        const tableName = rawTable
        const tableSegment = tableId || tableName
        const igHandle = normalizeIgHandle(contact_ig_username)
        console.log('[Airtable] atApiKey encontrada:', !!atApiKey)
        console.log('[Airtable] base_id:', base_id)
        console.log('[Airtable] table_name:', tableName)

        if (atApiKey && baseId && tableSegment && igHandle) {
          const basePath = encodeURIComponent(baseId)
          const tablePath = encodeURIComponent(tableSegment)
          const igUrl = `https://www.instagram.com/${igHandle}/`
          const filterFormula = `SEARCH("${igHandle}",{IG})`
          const existsUrl = `https://api.airtable.com/v0/${basePath}/${tablePath}?maxRecords=1&filterByFormula=${encodeURIComponent(filterFormula)}`

          console.log('[Airtable] Verificando duplicado...')
          const existsRes = await fetch(existsUrl, {
            headers: {
              Authorization: `Bearer ${atApiKey}`,
              Accept: 'application/json',
            },
          })
          const checkStatus = existsRes.status
          const checkBody = await existsRes.text()
          console.log('[Airtable] Response duplicado:', checkStatus, checkBody)

          let alreadyExists = false
          if (existsRes.ok) {
            let existsData: any = {}
            try {
              existsData = checkBody ? JSON.parse(checkBody) : {}
            } catch {
              existsData = {}
            }
            alreadyExists = Array.isArray(existsData?.records) && existsData.records.length > 0
          } else {
            console.error('Airtable duplicate check failed:', checkStatus, checkBody)
          }

          if (!alreadyExists) {
            console.log('[Airtable] Creando registro...')
            const createRes = await fetch(`https://api.airtable.com/v0/${basePath}/${tablePath}`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${atApiKey}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
              },
              body: JSON.stringify({
                fields: {
                  Nombre: fullName || '',
                  IG: igUrl,
                  'Vía': AIRTABLE_VIA_MANYCHAT,
                  Keyword: keyword || '',
                  'Fecha bot': new Date().toISOString(),
                },
              }),
            })
            const createStatus = createRes.status
            const createBody = await createRes.text()
            console.log('[Airtable] Response creación:', createStatus, createBody)
            if (!createRes.ok) {
              console.error('Airtable create failed:', createStatus, createBody)
            }
          }
        }
      } catch (e) {
        console.error('Airtable sync from ManyChat webhook failed:', e)
      }
    }

    return NextResponse.json({ success: true, chat_id: data?.chat_id })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}

// GET para que ManyChat pueda verificar que el endpoint existe
export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'manychat-webhook' })
}
