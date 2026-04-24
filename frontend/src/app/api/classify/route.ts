import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// POST /api/classify — Classify content using Claude AI
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await request.json()
  const { contentId, transcript, type = 'reel' } = body

  if (!transcript || transcript.length < 10) {
    return NextResponse.json({ error: 'Transcript too short' }, { status: 400 })
  }

  // Get master lists for context
  const { data: lists } = await supabase.from('master_lists').select('category, items').eq('user_id', user.id)
  const masterLists: Record<string, string[]> = {}
  ;(lists || []).forEach((r: { category: string; items: unknown }) => {
    masterLists[r.category] = Array.isArray(r.items) ? r.items as string[] : []
  })

  const dolores = masterLists.dolores || []
  const angulos = masterLists.angulos || []
  const ctas = masterLists.ctas || []

  // Build prompt
  const listLines: string[] = []
  if (dolores.length) listLines.push('DOLORES: ' + dolores.join(' | '))
  if (angulos.length) listLines.push('ANGULOS: ' + angulos.join(' | '))
  if (ctas.length) listLines.push('CTAs: ' + ctas.join(' | '))
  const listSection = listLines.length
    ? '\n\nLISTAS MAESTRAS (usa estos valores exactos si coinciden; si nada encaja bien escribe el valor detectado):\n' + listLines.join('\n')
    : ''

  const defs = `DEFINICIONES ESTRICTAS:
- dolor: El PROBLEMA GENERAL de la persona que ve el contenido. Es lo que lo motiva a actuar, lo que sufre o teme. Es un problema amplio. Ej: "Dependencia de ads", "No puede escalar", "Equipo que no vende solo", "Estancado en revenue".
- angulos: ARRAY con el PROBLEMA ESPECIFICO que se toca en el video y la SOLUCION ESPECIFICA que se presenta. Son conceptos propios, sistemas o mecanismos concretos. Ej: "VSL Chat", "Proceso de agendamiento corto", "Evergreen Value", "QuickCash". Si el video presenta multiples angulos, incluir todos.
- cta: Dejar VACIO siempre (el CTA se completa manualmente).`

  let strictInstr = ''
  if (dolores.length > 0) strictInstr += 'IMPORTANTE: Para "dolor", si alguno de la lista encaja usalo exacto. Si ninguno encaja, escribe uno nuevo descriptivo y corto.\n'
  if (angulos.length > 0) strictInstr += 'IMPORTANTE: Para "angulos", si alguno de la lista encaja usalo exacto. Si detectas un angulo nuevo que no esta en la lista, escribilo.\n'
  strictInstr += 'IMPORTANTE: "cta" SIEMPRE debe ser string vacio "".\n'

  const contentLabel = type === 'reel' ? 'reel de Instagram' : type === 'historia' ? 'secuencia de historias de Instagram' : 'video de YouTube'

  const prompt = `Analiza este transcript de un ${contentLabel} y extrae datos de marketing. Devuelve UNICAMENTE este JSON (sin markdown):
{"dolor":"","angulos":[""],"cta":"","titulo":""}

- titulo: Un titulo CORTO y descriptivo del contenido (maximo 8 palabras). Debe resumir el tema principal. NO copies la descripcion, crea un titulo nuevo.

${defs}${listSection}
${strictInstr}
TRANSCRIPT:
"""
${transcript}
"""`

  try {
    // Call Anthropic API
    const anthropicKey = process.env.ANTHROPIC_API_KEY
    if (!anthropicKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 350,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      return NextResponse.json({ error: `Claude API error (${res.status}): ${errText.substring(0, 200)}` }, { status: 500 })
    }

    const data = await res.json()
    const raw = data.content?.map((c: { text?: string }) => c.text || '').join('').trim() || ''
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

    let classification: { dolor: string; angulos: string[]; cta: string; titulo?: string }
    try {
      classification = JSON.parse(cleaned)
    } catch {
      return NextResponse.json({ error: 'Failed to parse AI response', raw: cleaned }, { status: 500 })
    }

    // Remove CTA from AI output — CTA is always manual
    classification.cta = ''

    // Auto-create new dolores/angulos in master lists if they don't exist
    const newDolor = classification.dolor && !dolores.includes(classification.dolor)
    if (newDolor) {
      await supabase.from('master_lists').upsert(
        { user_id: user.id, category: 'dolores', items: [...dolores, classification.dolor], updated_at: new Date().toISOString() },
        { onConflict: 'user_id,category' }
      )
    }
    const newAngulos = (classification.angulos || []).filter(a => a && !angulos.includes(a))
    if (newAngulos.length > 0) {
      await supabase.from('master_lists').upsert(
        { user_id: user.id, category: 'angulos', items: [...angulos, ...newAngulos], updated_at: new Date().toISOString() },
        { onConflict: 'user_id,category' }
      )
    }

    // Update content_items if contentId provided
    if (contentId) {
      await supabase.from('content_items').update({
        classification: {
          dolor: classification.dolor || '',
          angulos: classification.angulos || [],
          cta: '', // CTA always empty — user fills manually
        },
        updated_at: new Date().toISOString(),
      }).eq('id', contentId).eq('user_id', user.id)
    }

    return NextResponse.json({ success: true, classification })
  } catch (e) {
    return NextResponse.json({ error: `Classification failed: ${(e as Error).message}` }, { status: 500 })
  }
}
