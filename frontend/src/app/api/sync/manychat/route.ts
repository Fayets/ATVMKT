import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const MANYCHAT_API = 'https://api.manychat.com'

// GET /api/sync/manychat?action=tags — Fetch tags from ManyChat
// GET /api/sync/manychat?action=tag_contacts&tag_id=123 — Fetch contacts with a tag
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  // Get ManyChat API key from connections
  const { data: conn } = await supabase
    .from('api_connections')
    .select('credentials')
    .eq('user_id', user.id)
    .eq('platform', 'manychat')
    .maybeSingle()

  const apiKey = conn?.credentials?.api_key
  if (!apiKey) {
    return NextResponse.json({ error: 'ManyChat API key not configured. Go to Conexiones API.' }, { status: 400 })
  }

  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') || 'tags'

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Accept': 'application/json',
  }

  try {
    if (action === 'tags') {
      const resp = await fetch(`${MANYCHAT_API}/fb/page/getTags`, { headers })
      if (!resp.ok) {
        const err = await resp.text()
        return NextResponse.json({ error: `ManyChat API error: ${err}` }, { status: resp.status })
      }
      const data = await resp.json()
      return NextResponse.json({ tags: data.data || [] })
    }

    if (action === 'tag_contacts') {
      const tagId = searchParams.get('tag_id')
      if (!tagId) return NextResponse.json({ error: 'Missing tag_id' }, { status: 400 })

      const resp = await fetch(`${MANYCHAT_API}/fb/subscriber/getInfoByTag?tag_id=${tagId}`, { headers })
      if (!resp.ok) {
        const err = await resp.text()
        return NextResponse.json({ error: `ManyChat API error: ${err}` }, { status: resp.status })
      }
      const data = await resp.json()
      return NextResponse.json({ contacts: data.data || [] })
    }

    // Sync chats count for a content item by its linked ManyChat tag
    if (action === 'sync_content_chats') {
      const contentId = searchParams.get('content_id')
      const tagId = searchParams.get('tag_id')
      if (!tagId) return NextResponse.json({ error: 'Missing tag_id' }, { status: 400 })

      const resp = await fetch(`${MANYCHAT_API}/fb/subscriber/getInfoByTag?tag_id=${tagId}`, { headers })
      if (!resp.ok) {
        const err = await resp.text()
        return NextResponse.json({ error: `ManyChat API error: ${err}` }, { status: resp.status })
      }
      const data = await resp.json()
      const contacts = data.data || []
      const chatsCount = contacts.length

      // Update content_item if content_id provided
      if (contentId) {
        await supabase.from('content_items')
          .update({ chats: chatsCount, updated_at: new Date().toISOString() })
          .eq('id', contentId)
          .eq('user_id', user.id)
      }

      return NextResponse.json({ chats: chatsCount, contacts_count: contacts.length })
    }

    // Bulk sync all content items that have linked tags
    if (action === 'sync_all_content_chats') {
      const { data: linkedItems } = await supabase
        .from('content_items')
        .select('id, manychat_tag_id')
        .eq('user_id', user.id)
        .not('manychat_tag_id', 'is', null)

      if (!linkedItems || linkedItems.length === 0) {
        return NextResponse.json({ synced: 0, message: 'No content items with linked tags' })
      }

      let synced = 0
      for (const item of linkedItems) {
        try {
          const resp = await fetch(`${MANYCHAT_API}/fb/subscriber/getInfoByTag?tag_id=${item.manychat_tag_id}`, { headers })
          if (resp.ok) {
            const data = await resp.json()
            const count = (data.data || []).length
            await supabase.from('content_items')
              .update({ chats: count, updated_at: new Date().toISOString() })
              .eq('id', item.id)
            synced++
          }
        } catch { /* skip failed items */ }
      }

      return NextResponse.json({ synced, total: linkedItems.length })
    }

    return NextResponse.json({ error: 'Unknown action. Use: tags, tag_contacts, sync_content_chats, sync_all_content_chats' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: `Request failed: ${err}` }, { status: 500 })
  }
}
