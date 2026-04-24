import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// POST /api/youtube-analytics — Fetch CTR + retention from YouTube Analytics API
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  // Get OAuth2 tokens
  const { data: conn } = await supabase.from('api_connections').select('credentials').eq('platform', 'youtube').eq('user_id', user.id).maybeSingle()
  const creds = conn?.credentials as Record<string, string> | null
  const refreshToken = creds?.oauth_refresh_token

  if (!refreshToken) {
    return NextResponse.json({ error: 'YouTube Analytics no conectado. Apreta "Conectar YouTube Analytics".', needsReconnect: true }, { status: 400 })
  }

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'GOOGLE_CLIENT_ID/SECRET no configurados' }, { status: 500 })
  }

  // Always refresh the token (they expire in 1 hour)
  let accessToken: string
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId, client_secret: clientSecret,
        refresh_token: refreshToken, grant_type: 'refresh_token',
      }),
    })

    if (!tokenRes.ok) {
      const errText = await tokenRes.text()
      console.error('Token refresh failed:', errText)
      return NextResponse.json({ error: 'Token refresh falló. Reconecta YouTube Analytics.', needsReconnect: true }, { status: 401 })
    }

    const tokenData = await tokenRes.json()
    accessToken = tokenData.access_token

    // Save refreshed token
    await supabase.from('api_connections').update({
      credentials: { ...creds, oauth_access_token: accessToken, oauth_expires_at: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString() },
      updated_at: new Date().toISOString(),
    }).eq('user_id', user.id).eq('platform', 'youtube')
  } catch (e) {
    console.error('Token refresh error:', e)
    return NextResponse.json({ error: `Error refrescando token: ${(e as Error).message}` }, { status: 500 })
  }

  // Fetch analytics
  try {
    const body = await request.json()
    const startDate = body.startDate || '2020-01-01'
    const endDate = body.endDate || new Date().toISOString().split('T')[0]

    // Always use channel==MINE (the authenticated user's channel)
    // The user must authorize with the Google account that OWNS the YouTube channel
    const idsParam = 'channel==MINE'

    // Query 1: Views + retention per video
    const retentionParams = new URLSearchParams({
      ids: idsParam, startDate, endDate,
      metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage',
      dimensions: 'video', sort: '-views', maxResults: '200',
    })

    const retRes = await fetch(`https://youtubeanalytics.googleapis.com/v2/reports?${retentionParams}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!retRes.ok) {
      const err = await retRes.text()
      console.error('YouTube Analytics API error:', err)
      if (err.includes('SERVICE_DISABLED') || err.includes('has not been used in project')) {
        return NextResponse.json({ error: 'YouTube Analytics API no esta habilitada en Google Cloud. Habilitala en APIs & Services > Library > YouTube Analytics API > Enable.' }, { status: 403 })
      }
      if (retRes.status === 401 || retRes.status === 403) {
        return NextResponse.json({ error: 'Acceso denegado. Reconecta YouTube Analytics.', needsReconnect: true }, { status: 401 })
      }
      return NextResponse.json({ error: `YouTube Analytics error: ${err.substring(0, 200)}` }, { status: 500 })
    }

    const retData = await retRes.json()
    const retRows = retData.rows || []

    // Build lookup: videoId → retention data
    const analyticsMap: Record<string, { views: number; avgViewDuration: number; avgViewPercentage: number }> = {}
    for (const row of retRows) {
      analyticsMap[row[0]] = { views: row[1], avgViewDuration: row[3], avgViewPercentage: row[4] }
    }

    // Query 2: Try CTR metrics (may not be available for all channels)
    try {
      const ctrParams = new URLSearchParams({
        ids: idsParam, startDate, endDate,
        metrics: 'videoThumbnailImpressions,videoThumbnailImpressionsClickRate',
        dimensions: 'video', sort: '-videoThumbnailImpressions', maxResults: '200',
      })
      const ctrRes = await fetch(`https://youtubeanalytics.googleapis.com/v2/reports?${ctrParams}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (ctrRes.ok) {
        const ctrData = await ctrRes.json()
        for (const row of (ctrData.rows || [])) {
          const videoId = row[0]
          if (!analyticsMap[videoId]) analyticsMap[videoId] = { views: 0, avgViewDuration: 0, avgViewPercentage: 0 }
          ;(analyticsMap[videoId] as Record<string, unknown>).impressions = row[1]
          ;(analyticsMap[videoId] as Record<string, unknown>).ctrRaw = row[2]
        }
      }
    } catch { /* CTR query not supported for this channel type, skip */ }

    // Update each video in DB
    let updated = 0
    for (const [videoId, stats] of Object.entries(analyticsMap)) {
      const extId = `yt_${videoId}`
      const { data: existing } = await supabase
        .from('content_items')
        .select('id, metrics')
        .eq('user_id', user.id)
        .eq('external_id', extId)
        .limit(1)

      if (existing && existing.length > 0) {
        const oldMetrics = (existing[0].metrics || {}) as Record<string, unknown>
        const s = stats as Record<string, number>
        const retPercent = Math.round((s.avgViewPercentage || 0) * 10) / 10
        const ctrPercent = s.ctrRaw ? Math.round(s.ctrRaw * 1000) / 10 : (oldMetrics.ctr as number) || 0

        const newMetrics = {
          ...oldMetrics,
          views: s.views || oldMetrics.views,
          retention: retPercent || oldMetrics.retention,
          ctr: ctrPercent,
          avgViewDuration: s.avgViewDuration || oldMetrics.avgViewDuration,
          impressions: s.impressions || oldMetrics.impressions,
        }
        await supabase.from('content_items').update({ metrics: newMetrics, updated_at: new Date().toISOString() }).eq('id', existing[0].id)
        updated++
      }
    }

    return NextResponse.json({ success: true, updated, total: Object.keys(analyticsMap).length })
  } catch (e) {
    return NextResponse.json({ error: `Analytics failed: ${(e as Error).message}` }, { status: 500 })
  }
}
