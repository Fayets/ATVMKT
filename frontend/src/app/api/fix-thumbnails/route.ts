import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// POST /api/fix-thumbnails — Download Instagram CDN thumbnails and upload to Supabase Storage
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  // Get all content items with Instagram CDN thumbnails
  const { data: items } = await supabase
    .from('content_items')
    .select('id, external_id, content_type, metrics')
    .eq('user_id', user.id)
    .in('content_type', ['reel', 'story'])

  if (!items || items.length === 0) {
    return NextResponse.json({ message: 'No items to fix', fixed: 0 })
  }

  let fixed = 0
  let skipped = 0
  let failed = 0

  for (const item of items) {
    const metrics = (item.metrics || {}) as Record<string, unknown>
    const thumb = String(metrics.thumbnail || '')

    // Skip if no thumbnail or already a Supabase URL
    if (!thumb || thumb.includes('supabase.co')) {
      skipped++
      continue
    }

    try {
      // Download the image
      const imgRes = await fetch(thumb, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })

      if (!imgRes.ok) {
        failed++
        continue
      }

      const buffer = await imgRes.arrayBuffer()
      const contentType = imgRes.headers.get('content-type') || 'image/jpeg'
      const ext = contentType.includes('png') ? 'png' : 'jpg'
      const path = `${user.id}/${item.id}.${ext}`

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('thumbnails')
        .upload(path, buffer, {
          contentType,
          upsert: true,
        })

      if (uploadError) {
        failed++
        continue
      }

      // Get public URL
      const { data: urlData } = supabase.storage.from('thumbnails').getPublicUrl(path)
      const publicUrl = urlData.publicUrl

      // Update the content item
      const newMetrics = { ...metrics, thumbnail: publicUrl }
      await supabase
        .from('content_items')
        .update({ metrics: newMetrics, updated_at: new Date().toISOString() })
        .eq('id', item.id)

      fixed++
    } catch {
      failed++
    }
  }

  return NextResponse.json({ fixed, skipped, failed, total: items.length })
}
