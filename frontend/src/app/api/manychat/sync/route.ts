import { createClient } from '@/lib/supabase/client'
import { NextResponse } from 'next/server'

const MANYCHAT_API_KEY = process.env.MANYCHAT_API_KEY || ''
const MANYCHAT_BASE = 'https://api.manychat.com/fb'

// POST /api/manychat/sync — Sincroniza contactos de ManyChat a cache local
// Recibe: { ig_usernames: string[] } o { sync_all_tags: true }
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const supabase = createClient()

    // Opción 1: Sync por subscriber_id directo
    if (body.subscriber_id) {
      const sub = await getSubscriberInfo(body.subscriber_id)
      if (sub?.ig_username) {
        await cacheSubscriber(supabase, sub)
        return NextResponse.json({ success: true, cached: sub.ig_username })
      }
      return NextResponse.json({ error: 'Subscriber not found' }, { status: 404 })
    }

    // Opción 2: Sync por lista de subscriber_ids
    if (body.subscriber_ids?.length) {
      const results = []
      for (const id of body.subscriber_ids) {
        const sub = await getSubscriberInfo(id)
        if (sub?.ig_username) {
          await cacheSubscriber(supabase, sub)
          results.push(sub.ig_username)
        }
      }
      return NextResponse.json({ success: true, cached: results })
    }

    // Opción 3: Sync todos los tags CTA y sus subscribers
    if (body.sync_all_tags) {
      const tags = await getAllTags()
      const ctaTags = tags.filter((t: { name: string }) => {
        const n = t.name.toUpperCase()
        return n.includes('CTA') || n.includes('HISTORIA') || n.includes('REEL') || n.includes('VSL')
      })

      let total = 0
      for (const tag of ctaTags) {
        const subs = await getSubscribersByTag(tag.id)
        for (const sub of subs) {
          if (sub.ig_username) {
            await cacheSubscriber(supabase, sub)
            total++
          }
        }
      }
      return NextResponse.json({ success: true, total_cached: total, tags_processed: ctaTags.length })
    }

    return NextResponse.json({ error: 'Provide subscriber_id, subscriber_ids, or sync_all_tags' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

async function getSubscriberInfo(id: string) {
  const res = await fetch(`${MANYCHAT_BASE}/subscriber/getInfo?subscriber_id=${id}`, {
    headers: { 'Authorization': `Bearer ${MANYCHAT_API_KEY}` },
  })
  if (!res.ok) return null
  const data = await res.json()
  return data.status === 'success' ? data.data : null
}

async function getAllTags() {
  const res = await fetch(`${MANYCHAT_BASE}/page/getTags`, {
    headers: { 'Authorization': `Bearer ${MANYCHAT_API_KEY}` },
  })
  if (!res.ok) return []
  const data = await res.json()
  return data.status === 'success' ? data.data : []
}

async function getSubscribersByTag(_tagId: number): Promise<Array<{ ig_username: string; id: string; tags: Array<{ id: number; name: string }>; subscribed: string }>> {
  // ManyChat no tiene endpoint para listar subscribers por tag
  return []
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function cacheSubscriber(supabase: any, sub: any) {
  const tags = (sub.tags || []).map((t: { id: number; name: string }) => ({ id: t.id, name: t.name }))
  await supabase.from('manychat_contacts').upsert({
    ig_username: sub.ig_username.toLowerCase(),
    subscriber_id: sub.id,
    tags: JSON.stringify(tags),
    subscribed_at: sub.subscribed,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'ig_username' })
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'manychat-sync' })
}
