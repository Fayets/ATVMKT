import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// POST /api/sync/apify — Sync Instagram Reels via Apify
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await request.json()
  const { apiToken, igHandle, limit = 20 } = body

  if (!apiToken || !igHandle) {
    return NextResponse.json({ error: 'Missing apiToken or igHandle' }, { status: 400 })
  }

  try {
    // Step 1: Start Apify actor
    const actorUrl = `https://api.apify.com/v2/acts/apify~instagram-reel-scraper/runs?token=${encodeURIComponent(apiToken)}`
    const igUrl = `https://www.instagram.com/${igHandle.replace('@', '')}/`

    const startResp = await fetch(actorUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: [igUrl],
        resultsLimit: Math.min(limit, 100),
        includeTranscript: true,
        skipPinnedPosts: false,
      }),
    })

    if (!startResp.ok) {
      const errText = await startResp.text()
      return NextResponse.json({ error: `Apify start failed (${startResp.status}): ${errText.substring(0, 200)}` }, { status: 500 })
    }

    const runInfo = await startResp.json()
    const runId = runInfo.data?.id
    const datasetId = runInfo.data?.defaultDatasetId
    if (!runId) return NextResponse.json({ error: 'Apify did not return a run ID' }, { status: 500 })

    // Step 2: Poll until done (max 5 min)
    const maxWait = 300000
    let waited = 0
    const pollInterval = 5000
    let runStatus = 'RUNNING'

    while (runStatus === 'RUNNING' || runStatus === 'READY') {
      if (waited >= maxWait) return NextResponse.json({ error: 'Timeout: scraper took more than 5 min' }, { status: 504 })
      await new Promise(r => setTimeout(r, pollInterval))
      waited += pollInterval

      const pollResp = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${encodeURIComponent(apiToken)}`)
      if (pollResp.ok) {
        const pollData = await pollResp.json()
        runStatus = pollData.data?.status || 'FAILED'
      }
    }

    if (runStatus !== 'SUCCEEDED') {
      return NextResponse.json({ error: `Scraper finished with status: ${runStatus}` }, { status: 500 })
    }

    // Step 3: Fetch dataset
    const dsResp = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${encodeURIComponent(apiToken)}&limit=100`)
    if (!dsResp.ok) return NextResponse.json({ error: `Failed to fetch dataset (${dsResp.status})` }, { status: 500 })
    const posts = await dsResp.json()

    if (!posts || !posts.length) {
      return NextResponse.json({ error: `No results for @${igHandle}` }, { status: 404 })
    }

    // Step 4: Upsert into Supabase
    let newCount = 0
    let updCount = 0

    for (const post of posts) {
      const shortCode = post.shortCode || post.id || ''
      const extId = `apify_${shortCode}`
      const caption = post.caption || post.alt || ''
      const title = caption.substring(0, 200)
      const pubDate = post.timestamp || new Date().toISOString()
      const permalink = post.url || (shortCode ? `https://www.instagram.com/reel/${shortCode}/` : '')
      const thumbUrl = post.displayUrl || post.images?.[0] || ''

      // Upload thumbnail to Supabase Storage for permanent URL
      let permanentThumb = thumbUrl
      if (thumbUrl) {
        try {
          const imgRes = await fetch(thumbUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
          if (imgRes.ok) {
            const buffer = await imgRes.arrayBuffer()
            const ct = imgRes.headers.get('content-type') || 'image/jpeg'
            const ext = ct.includes('png') ? 'png' : 'jpg'
            const path = `${user.id}/${extId}.${ext}`
            const { error: upErr } = await supabase.storage.from('thumbnails').upload(path, buffer, { contentType: ct, upsert: true })
            if (!upErr) {
              const { data: urlData } = supabase.storage.from('thumbnails').getPublicUrl(path)
              permanentThumb = urlData.publicUrl
            }
          }
        } catch { /* keep original URL as fallback */ }
      }

      const metrics = {
        views: post.videoPlayCount || post.videoViewCount || post.viewCount || 0,
        likes: post.likesCount || 0,
        comments: post.commentsCount || 0,
        saves: post.savesCount || 0,
        shares: post.sharesCount || 0,
        reach: 0,
        thumbnail: permanentThumb,
      }

      const transcript = post.transcript || ''
      // Chats = comments / 2 (rounded)
      const chats = Math.round((post.commentsCount || 0) / 2)

      const { data: existing } = await supabase
        .from('content_items')
        .select('id, chats')
        .eq('user_id', user.id)
        .eq('external_id', extId)
        .limit(1)

      const row = {
        title,
        content_type: 'reel' as const,
        platform: 'instagram' as const,
        metrics,
        // Only set chats on new entries or if existing has 0
        chats: existing?.[0] && Number(existing[0].chats) > 0 ? undefined : chats,
        classification: { transcript },
        published_at: pubDate,
        url: permalink || null,
        notes: caption,
        updated_at: new Date().toISOString(),
      }

      if (existing && existing.length > 0) {
        await supabase.from('content_items').update(row).eq('id', existing[0].id)
        updCount++
      } else {
        await supabase.from('content_items').insert({ ...row, user_id: user.id, external_id: extId })
        newCount++
      }
    }

    return NextResponse.json({
      success: true,
      total: posts.length,
      new: newCount,
      updated: updCount,
    })
  } catch (e) {
    return NextResponse.json({ error: `Sync failed: ${(e as Error).message}` }, { status: 500 })
  }
}
