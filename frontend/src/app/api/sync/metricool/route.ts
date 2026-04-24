import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// POST /api/sync/metricool — Sync ONLY Stories from Metricool (reels use Apify)
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await request.json()
  const { userToken, userId: mcUserId, blogId, startDate, endDate } = body
  if (!userToken || !mcUserId || !blogId) return NextResponse.json({ error: 'Missing Metricool credentials' }, { status: 400 })

  const headers: Record<string, string> = { 'X-Mc-Auth': userToken }
  const fromParam = `${startDate}T00:00:00`
  const toParam = `${endDate}T23:59:59`
  let newCount = 0, updCount = 0

  try {
    // ── Only fetch Stories (reels are handled by Apify) ──
    const storiesUrl = `https://app.metricool.com/api/v2/analytics/stories/instagram?blogId=${blogId}&userId=${mcUserId}&from=${encodeURIComponent(fromParam)}&to=${encodeURIComponent(toParam)}`
    const storiesResp = await fetch(storiesUrl, { headers })
    let storiesData: Record<string, unknown>[] = []
    if (storiesResp.ok) {
      const result = await storiesResp.json()
      storiesData = Array.isArray(result) ? result : (result.data || [])
    } else if (storiesResp.status === 401) {
      return NextResponse.json({ error: 'Metricool 401 — verifica tu User Token' }, { status: 401 })
    }

    // ── Save individual story slides ──
    for (const s of storiesData) {
      const extId = `metricool_story_${s.postId || s.id || Math.random()}`
      const pubAt = s.publishedAt as Record<string, string> | string | null
      const pubDate = typeof pubAt === 'object' && pubAt?.dateTime ? pubAt.dateTime : String(pubAt || new Date().toISOString())
      const permalink = String(s.permalink || s.url || '')
      const thumbUrl = String(s.thumbnailUrl || s.mediaUrl || s.imageUrl || '')

      const metrics = {
        views: Number(s.impressions || s.views || 0),
        replies: Number(s.replies || 0),
        exits: Number(s.exits || 0),
        reach: Number(s.reach || 0),
        tapsForward: Number(s.tapsForward || 0),
        tapsBack: Number(s.tapsBack || 0),
        thumbnail: thumbUrl,
      }

      const { data: existing } = await supabase.from('content_items').select('id').eq('user_id', user.id).eq('external_id', extId).limit(1)

      if (existing && existing.length > 0) {
        await supabase.from('content_items').update({ content_type: 'story', platform: 'instagram', metrics, published_at: pubDate, url: permalink || null, updated_at: new Date().toISOString() }).eq('id', existing[0].id)
        updCount++
      } else {
        await supabase.from('content_items').insert({ user_id: user.id, external_id: extId, title: '', content_type: 'story', platform: 'instagram', metrics, published_at: pubDate, url: permalink || null })
        newCount++
      }
    }

    // ── Auto-create secuencias grouped by day ──
    const storyByDate: Record<string, { replies: number; count: number }> = {}
    for (const s of storiesData) {
      const pubAt = s.publishedAt as Record<string, string> | string | null
      const pubDate = typeof pubAt === 'object' && pubAt?.dateTime ? pubAt.dateTime : String(pubAt || '')
      const fecha = pubDate.split('T')[0]
      if (!fecha) continue
      if (!storyByDate[fecha]) storyByDate[fecha] = { replies: 0, count: 0 }
      storyByDate[fecha].replies += Number(s.replies || 0)
      storyByDate[fecha].count++
    }

    let secCreated = 0
    for (const [fecha, data] of Object.entries(storyByDate)) {
      const extId = `secuencia_${fecha}`
      const chats = data.replies // Stories: replies = chats directos

      const { data: existing } = await supabase.from('content_items').select('id').eq('user_id', user.id).eq('external_id', extId).limit(1)

      if (!existing || existing.length === 0) {
        await supabase.from('content_items').insert({
          user_id: user.id, external_id: extId,
          content_type: 'historia', platform: 'instagram',
          title: `Secuencia ${fecha} (${data.count} stories)`,
          chats, metrics: { replies: data.replies }, published_at: `${fecha}T12:00:00`,
          notes: `${data.count} historias`,
          classification: null,
        })
        secCreated++
      } else {
        await supabase.from('content_items').update({
          chats,
          title: `Secuencia ${fecha} (${data.count} stories)`,
          notes: `${data.count} historias`,
          metrics: { replies: data.replies },
          updated_at: new Date().toISOString(),
        }).eq('id', existing[0].id)
      }
    }

    await supabase.from('api_connections').update({ last_sync_at: new Date().toISOString() }).eq('user_id', user.id).eq('platform', 'metricool')

    // ── Auto-classify new secuencias using story thumbnails + Claude Vision ──
    let classified = 0
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (apiKey && secCreated > 0) {
      // Get master lists for classification context
      const { data: lists } = await supabase.from('master_lists').select('category, items').eq('user_id', user.id)
      const ml: Record<string, string[]> = {}
      ;(lists || []).forEach((r: { category: string; items: unknown }) => { ml[r.category] = Array.isArray(r.items) ? r.items as string[] : [] })

      // Get unclassified secuencias (null classification OR empty dolor)
      const { data: allSecs } = await supabase.from('content_items')
        .select('id, published_at, classification')
        .eq('user_id', user.id).eq('content_type', 'historia')
      const unclassified = (allSecs || []).filter(s => {
        const cls = s.classification as Record<string, unknown> | null
        return !cls || !cls.dolor || String(cls.dolor).trim() === ''
      })

      for (const sec of (unclassified || [])) {
        const fecha = String(sec.published_at || '').split('T')[0]
        // Get story thumbnails for this date
        const { data: stories } = await supabase.from('content_items')
          .select('metrics').eq('user_id', user.id).eq('content_type', 'story')
          .gte('published_at', `${fecha}T00:00:00`).lte('published_at', `${fecha}T23:59:59`)
          .limit(3)

        const thumbUrls = (stories || [])
          .map(s => String((s.metrics as Record<string, unknown>)?.thumbnail || ''))
          .filter(u => u && u.startsWith('http'))
          .slice(0, 2)

        if (thumbUrls.length === 0) continue

        try {
          // Download first thumbnail and convert to base64
          const imgRes = await fetch(thumbUrls[0], { headers: { 'User-Agent': 'Mozilla/5.0' } })
          if (!imgRes.ok) continue
          const buf = Buffer.from(await imgRes.arrayBuffer())
          const base64 = buf.toString('base64')
          const mediaType = imgRes.headers.get('content-type') || 'image/jpeg'

          const listCtx: string[] = []
          if (ml.dolores?.length) listCtx.push('DOLORES: ' + ml.dolores.join(' | '))
          if (ml.angulos?.length) listCtx.push('ANGULOS: ' + ml.angulos.join(' | '))

          const prompt = `Analiza esta story de Instagram y clasifica:
${listCtx.join('\n')}

Responde SOLO JSON: {"dolor":"","angulos":[""],"cta":"","titulo":""}
- dolor: problema general que toca la story (usa uno de DOLORES si aplica)
- angulos: enfoque/solucion (usa de ANGULOS si aplica, puede ser nuevo)
- cta: dejalo vacio
- titulo: titulo corto de 5 palabras`

          const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 300,
              messages: [{ role: 'user', content: [
                { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
                { type: 'text', text: prompt },
              ] }],
            }),
          })

          if (claudeRes.ok) {
            const cData = await claudeRes.json()
            const text = cData.content?.[0]?.text || ''
            const jsonMatch = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
            const parsed = JSON.parse(jsonMatch)

            await supabase.from('content_items').update({
              classification: { dolor: parsed.dolor || '', angulos: parsed.angulos || [], cta: '', secuencia: '' },
              updated_at: new Date().toISOString(),
            }).eq('id', sec.id)
            classified++
          }
        } catch { /* skip classification errors */ }
      }
    }

    return NextResponse.json({ success: true, stories: storiesData.length, secuencias: secCreated, classified, new: newCount, updated: updCount })
  } catch (e) {
    return NextResponse.json({ error: `Metricool sync failed: ${(e as Error).message}` }, { status: 500 })
  }
}
