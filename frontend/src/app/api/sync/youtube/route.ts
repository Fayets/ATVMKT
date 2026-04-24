import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// POST /api/sync/youtube — Sync YouTube videos via YouTube Data API v3
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await request.json()
  const { apiKey, channelId } = body

  if (!apiKey || !channelId) {
    return NextResponse.json({ error: 'Missing apiKey or channelId' }, { status: 400 })
  }

  try {
    // Step 1: Fetch latest video IDs from channel
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(channelId)}&type=video&order=date&maxResults=50&key=${encodeURIComponent(apiKey)}`
    const searchResp = await fetch(searchUrl)
    if (!searchResp.ok) {
      const errText = await searchResp.text()
      return NextResponse.json({ error: `YouTube API error (${searchResp.status}): ${errText.substring(0, 200)}` }, { status: 500 })
    }
    const searchData = await searchResp.json()
    const searchItems = searchData.items || []

    // Step 2: Get detailed stats in batches of 10 (avoids URL length issues)
    const videoIds = searchItems.map((v: Record<string, unknown>) => {
      const id = v.id as Record<string, string> | string
      return typeof id === 'string' ? id : id?.videoId
    }).filter(Boolean) as string[]

    let statsMap: Record<string, { views: number; likes: number; comments: number; description: string }> = {}
    for (let i = 0; i < videoIds.length; i += 10) {
      const batch = videoIds.slice(i, i + 10)
      try {
        const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${batch.join(',')}&key=${encodeURIComponent(apiKey)}`
        const statsResp = await fetch(statsUrl)
        if (statsResp.ok) {
          const statsText = await statsResp.text()
          // Handle special characters in description
          const statsData = JSON.parse(statsText.replace(/[\x00-\x1f]/g, ' '))
          for (const item of (statsData.items || [])) {
            statsMap[item.id] = {
              views: Number(item.statistics?.viewCount) || 0,
              likes: Number(item.statistics?.likeCount) || 0,
              comments: Number(item.statistics?.commentCount) || 0,
              description: (item.snippet?.description || '').replace(/[\x00-\x1f]/g, ' '),
            }
          }
        }
      } catch (e) {
        console.error(`Stats batch ${i} failed:`, (e as Error).message)
      }
    }

    let newCount = 0, updCount = 0
    const now = new Date().toISOString()

    for (const v of searchItems) {
      const videoId = (v.id as Record<string, string>)?.videoId || v.id
      if (!videoId || typeof videoId !== 'string') continue

      const extId = `yt_${videoId}`
      const title = v.snippet?.title || ''
      const pubDate = v.snippet?.publishedAt || now
      const thumbnail = v.snippet?.thumbnails?.maxres?.url || v.snippet?.thumbnails?.high?.url || v.snippet?.thumbnails?.medium?.url || ''
      const stats = statsMap[videoId] || { views: 0, likes: 0, comments: 0, description: '' }

      // Check existing record
      const { data: existing } = await supabase
        .from('content_items')
        .select('id, title, metrics, classification')
        .eq('user_id', user.id)
        .eq('external_id', extId)
        .limit(1)

      if (existing && existing.length > 0) {
        const old = existing[0]
        const oldMetrics = (old.metrics || {}) as Record<string, unknown>
        const oldThumb = oldMetrics.thumbnail as string || ''
        const oldTitle = old.title || ''

        // Track thumbnail changes
        const thumbHistory = (oldMetrics.thumbnailHistory || []) as { url: string; date: string }[]
        if (oldThumb && thumbnail && oldThumb !== thumbnail) {
          thumbHistory.push({ url: oldThumb, date: now })
        }

        // Track title changes
        const titleHistory = (oldMetrics.titleHistory || []) as { title: string; date: string }[]
        if (oldTitle && title && oldTitle !== title) {
          titleHistory.push({ title: oldTitle, date: now })
        }

        // Track performance snapshots (one per sync)
        const perfHistory = (oldMetrics.performanceHistory || []) as { date: string; views: number; likes: number; comments: number }[]
        perfHistory.push({ date: now, views: stats.views, likes: stats.likes, comments: stats.comments })
        // Keep last 90 snapshots max
        if (perfHistory.length > 90) perfHistory.splice(0, perfHistory.length - 90)

        const metrics = {
          ...oldMetrics,
          thumbnail, views: stats.views, likes: stats.likes, comments: stats.comments,
          thumbnailHistory: thumbHistory, titleHistory: titleHistory,
          performanceHistory: perfHistory,
        }

        // Store description in classification
        const oldCls = (old.classification || {}) as Record<string, unknown>
        const classification = { ...oldCls, description: stats.description }

        await supabase.from('content_items').update({
          title, metrics, classification,
          published_at: pubDate, updated_at: now,
        }).eq('id', old.id)
        updCount++
      } else {
        const metrics = {
          thumbnail, views: stats.views, likes: stats.likes, comments: stats.comments,
          thumbnailHistory: [], titleHistory: [],
          performanceHistory: [{ date: now, views: stats.views, likes: stats.likes, comments: stats.comments }],
        }

        await supabase.from('content_items').insert({
          user_id: user.id, external_id: extId, title,
          content_type: 'video', platform: 'youtube',
          metrics, classification: { description: stats.description },
          published_at: pubDate, url: `https://youtube.com/watch?v=${videoId}`,
        })
        newCount++
      }
    }

    await supabase.from('api_connections').update({ last_sync_at: now }).eq('user_id', user.id).eq('platform', 'youtube')

    return NextResponse.json({ success: true, total: searchItems.length, new: newCount, updated: updCount })
  } catch (e) {
    return NextResponse.json({ error: `YouTube sync failed: ${(e as Error).message}` }, { status: 500 })
  }
}
