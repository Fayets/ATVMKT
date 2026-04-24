import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// POST /api/classify-all-secuencias — Classify all unclassified secuencias using Vision
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 })

  // Get master lists
  const { data: lists } = await supabase.from('master_lists').select('category, items').eq('user_id', user.id)
  const ml: Record<string, string[]> = {}
  ;(lists || []).forEach((r: { category: string; items: unknown }) => { ml[r.category] = Array.isArray(r.items) ? r.items as string[] : [] })

  // Get ALL secuencias without dolor
  const { data: allSecs } = await supabase.from('content_items')
    .select('id, published_at, classification')
    .eq('user_id', user.id).eq('content_type', 'historia')

  const unclassified = (allSecs || []).filter(s => {
    const cls = s.classification as Record<string, unknown> | null
    return !cls || !cls.dolor || String(cls.dolor).trim() === ''
  })

  if (unclassified.length === 0) return NextResponse.json({ classified: 0, message: 'All classified' })

  let classified = 0
  const errors: string[] = []

  for (const sec of unclassified) {
    const fecha = String(sec.published_at || '').split('T')[0]

    // Get story thumbnails for this date
    const { data: stories } = await supabase.from('content_items')
      .select('metrics').eq('user_id', user.id).eq('content_type', 'story')
      .gte('published_at', `${fecha}T00:00:00`).lte('published_at', `${fecha}T23:59:59`)
      .limit(3)

    const thumbUrl = (stories || [])
      .map(s => String((s.metrics as Record<string, unknown>)?.thumbnail || ''))
      .find(u => u.startsWith('http'))

    if (!thumbUrl) {
      errors.push(`${fecha}: no thumbnails found`)
      continue
    }

    try {
      // Download thumbnail
      const imgRes = await fetch(thumbUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (!imgRes.ok) { errors.push(`${fecha}: fetch failed ${imgRes.status}`); continue }

      const buf = Buffer.from(await imgRes.arrayBuffer())
      const base64 = buf.toString('base64')
      const mediaType = imgRes.headers.get('content-type') || 'image/jpeg'

      const listCtx: string[] = []
      if (ml.dolores?.length) listCtx.push('DOLORES existentes: ' + ml.dolores.join(' | '))
      if (ml.angulos?.length) listCtx.push('ANGULOS existentes: ' + ml.angulos.join(' | '))

      const prompt = `Analiza esta story de Instagram. Clasifica el contenido.
${listCtx.join('\n')}

Responde SOLO con JSON valido, sin markdown:
{"dolor":"el problema principal que toca","angulos":["enfoque o solucion que propone"],"titulo":"titulo corto 5 palabras"}

- Para dolor: usa uno de DOLORES existentes si aplica, o crea uno nuevo descriptivo
- Para angulos: usa de ANGULOS existentes si aplica, o crea nuevos
- Si no puedes determinar, pon lo mas cercano basado en lo visual`

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

      if (!claudeRes.ok) {
        const errText = await claudeRes.text()
        errors.push(`${fecha}: Claude API ${claudeRes.status} - ${errText.substring(0, 100)}`)
        continue
      }

      const cData = await claudeRes.json()
      const rawText = cData.content?.[0]?.text || ''
      const jsonStr = rawText.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
      const parsed = JSON.parse(jsonStr)

      if (parsed.dolor) {
        await supabase.from('content_items').update({
          classification: { dolor: parsed.dolor, angulos: parsed.angulos || [], cta: '', secuencia: '' },
          updated_at: new Date().toISOString(),
        }).eq('id', sec.id)
        classified++
      } else {
        errors.push(`${fecha}: AI returned empty dolor`)
      }
    } catch (e) {
      errors.push(`${fecha}: ${(e as Error).message}`)
    }
  }

  return NextResponse.json({ classified, total: unclassified.length, errors })
}
