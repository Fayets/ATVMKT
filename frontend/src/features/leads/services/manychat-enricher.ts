import { createClient } from '@/lib/supabase/client'

const MANYCHAT_BASE_URL = 'https://api.manychat.com/fb'

async function getManychatApiKey(): Promise<string> {
  const fromEnv = process.env.MANYCHAT_API_KEY?.trim()
  if (fromEnv) return fromEnv
  try {
    const sb = createClient()
    const { data } = await sb.from('api_connections').select('credentials').eq('platform', 'manychat').limit(1).single()
    if (data?.credentials?.api_key) return data.credentials.api_key as string
  } catch { /* fallback */ }
  return ''
}

type ManychatTag = { id: number; name: string }
type ManychatSubscriber = {
  id: string
  ig_username: string | null
  subscribed: string
  tags: ManychatTag[]
  name: string
}

export type EnrichmentResult = {
  entry_funnel: string | null
  agenda_point: string | null
  first_contact_at: string | null
  ctas_responded: number
}

function extractIgUsername(igHandle: string): string {
  if (!igHandle) return ''
  const match = igHandle.match(/instagram\.com\/([^/?]+)/)
  if (match) return match[1].toLowerCase().replace(/\/$/, '')
  return igHandle.toLowerCase().replace('@', '')
}

function isCtaTag(tagName: string): boolean {
  const upper = tagName.toUpperCase()
  return upper.includes('CTA') ||
    upper.includes('HISTORIA') ||
    upper.includes('REEL') ||
    upper.includes('VSL') ||
    upper.includes('CARRUSEL') ||
    upper.includes('RESPONDIERON')
}

async function findSubscriber(name: string, igUsername: string, email?: string | null): Promise<ManychatSubscriber | null> {
  const apiKey = await getManychatApiKey()
  if (!apiKey) return null
  const target = igUsername.toLowerCase()
  const headers = { 'Authorization': `Bearer ${apiKey}` }

  // Estrategia 1: buscar por email
  if (email) {
    const res = await fetch(`${MANYCHAT_BASE_URL}/subscriber/findBySystemField?email=${encodeURIComponent(email)}`, { headers })
    if (res.ok) {
      const data = await res.json()
      if (data.status === 'success' && data.data?.ig_username?.toLowerCase() === target) return data.data
    }
  }

  // Estrategia 2: buscar por nombre
  if (name) {
    const terms = [...new Set([name.split(' ')[0], name].filter(Boolean))]
    for (const term of terms) {
      const res = await fetch(`${MANYCHAT_BASE_URL}/subscriber/findByName?name=${encodeURIComponent(term)}`, { headers })
      if (!res.ok) continue
      const data = await res.json()
      if (data.status !== 'success' || !data.data) continue
      const match = data.data.find((s: ManychatSubscriber) => s.ig_username?.toLowerCase() === target)
      if (match) return match
    }
  }

  // Estrategia 3: cache local (manychat_contacts)
  try {
    const supabase = createClient()
    const { data: cached } = await supabase
      .from('manychat_contacts')
      .select('subscriber_id, tags, subscribed_at')
      .eq('ig_username', target)
      .limit(1)

    if (cached?.[0]?.subscriber_id) {
      const res = await fetch(`${MANYCHAT_BASE_URL}/subscriber/getInfo?subscriber_id=${cached[0].subscriber_id}`, { headers })
      if (res.ok) {
        const data = await res.json()
        if (data.status === 'success') return data.data
      }
      const tags = typeof cached[0].tags === 'string' ? JSON.parse(cached[0].tags) : cached[0].tags
      return { id: cached[0].subscriber_id, ig_username: target, subscribed: cached[0].subscribed_at, tags: tags || [], name: '' }
    }
  } catch { /* ignore */ }

  // Estrategia 4: manychat_chats por ig_username
  try {
    const supabase = createClient()
    const { data: chats } = await supabase
      .from('manychat_chats')
      .select('manychat_contact_id')
      .eq('contact_ig_username', igUsername)
      .limit(1)

    if (chats?.[0]?.manychat_contact_id && !chats[0].manychat_contact_id.includes('{{')) {
      const res = await fetch(`${MANYCHAT_BASE_URL}/subscriber/getInfo?subscriber_id=${chats[0].manychat_contact_id}`, { headers })
      if (res.ok) {
        const data = await res.json()
        if (data.status === 'success') return data.data
      }
    }
  } catch { /* ignore */ }

  return null
}

export async function enrichLeadFromManychat(
  clientName: string,
  igHandle: string | null,
  email?: string | null
): Promise<EnrichmentResult> {
  const empty: EnrichmentResult = { entry_funnel: null, agenda_point: null, first_contact_at: null, ctas_responded: 0 }

  if (!igHandle) return empty

  try {
    const igUsername = extractIgUsername(igHandle)
    if (!igUsername) return empty

    const subscriber = await findSubscriber(clientName || '', igUsername, email)
    if (!subscriber) return empty

    const ctaTags = subscriber.tags.filter(t => isCtaTag(t.name))
    const firstContact = subscriber.subscribed ? subscriber.subscribed.split('T')[0] : null

    if (ctaTags.length === 0) return { ...empty, first_contact_at: firstContact }

    return {
      entry_funnel: ctaTags[ctaTags.length - 1].name.trim(),
      agenda_point: ctaTags[0].name.trim(),
      first_contact_at: firstContact,
      ctas_responded: ctaTags.length,
    }
  } catch {
    return empty
  }
}
