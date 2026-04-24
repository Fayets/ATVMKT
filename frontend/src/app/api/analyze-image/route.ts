import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// POST /api/analyze-image — Analyze a screenshot of Instagram stories with Claude Vision
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await request.json()
  const { imageBase64, mediaType = 'image/jpeg' } = body

  if (!imageBase64) return NextResponse.json({ error: 'No image provided' }, { status: 400 })

  // Get master lists for context
  const { data: lists } = await supabase.from('master_lists').select('category, items').eq('user_id', user.id)
  const masterLists: Record<string, string[]> = {}
  ;(lists || []).forEach((r: { category: string; items: unknown }) => {
    masterLists[r.category] = Array.isArray(r.items) ? r.items as string[] : []
  })

  const dolores = masterLists.dolores || []
  const angulos = masterLists.angulos || []

  const listSection = [
    dolores.length ? 'DOLORES disponibles: ' + dolores.join(' | ') : '',
    angulos.length ? 'ANGULOS disponibles: ' + angulos.join(' | ') : '',
  ].filter(Boolean).join('\n')

  const prompt = `Este screenshot es del "Archivo de historias" de Instagram. Muestra una grilla de 3 columnas con stories.

Responde con este JSON (sin markdown, sin backticks):
{"reasoning":{"row1":["desc izq","desc centro","desc der"],"row2":["desc izq","desc centro","desc der"],"row3":["desc izq","desc centro","desc der"]},"totalStoriesInGrid":9,"allSlides":["1","2","3","4","5","6","7","8","9"],"sequencePositions":[2,3,4,5,6,7,8],"dolor":"","angulos":[""],"gridInfo":{"headerHeightPercent":14,"rows":3,"cols":3}}

INSTRUCCIONES:

1. IGNORA el header (barra de estado, "Archivo de historias", iconos). Solo mira la GRILLA de stories debajo.

2. LEER LA GRILLA — 3 columnas, fila por fila:
   - En "reasoning", describe las 3 stories de cada fila (izquierda, centro, derecha)
   - Si una fila tiene menos de 3 stories, pon null en las posiciones vacias
   - Cada story ocupa exactamente UNA celda de la grilla
   - NO cuentes el header como una story
   - NO cuentes una story dos veces

3. NUMERAR: Las stories se numeran 1,2,3 (fila 1), 4,5,6 (fila 2), 7,8,9 (fila 3), etc.
   "allSlides" tiene UNA descripcion por story. TOTAL = filas * 3 (o menos si ultima fila es parcial).

4. SECUENCIA — Busca el grupo CONSECUTIVO mas grande de stories del mismo dia/tema:
   - En Instagram, posicion 1 = story MAS RECIENTE
   - Busca FECHAS visibles (ej: "19 mar", "23 mar") — stories de dias diferentes = secuencias diferentes
   - IMPORTANTE: Una fecha/sticker de dia aparece EN UNA story especifica. No asumas que aplica a la story de al lado. Mira EXACTAMENTE en que celda de la grilla aparece cada fecha
   - Si story 1 es de otro tema/dia que story 2 → excluyela (es de una secuencia mas nueva)
   - Solo excluye la ULTIMA story si tiene una fecha de otro dia VISIBLE EN ESA STORY ESPECIFICA
   - sequencePositions DEBE ser un rango consecutivo: [2,3,4,5,6,7,8] ✓ — [1,3,5,7] ✗

5. DOLOR/ANGULOS: Que problema aborda la secuencia y desde que angulo.

${listSection}

Solo JSON. Nada mas.`

  try {
    const anthropicKey = process.env.ANTHROPIC_API_KEY
    if (!anthropicKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 16000,
        thinking: { type: 'enabled', budget_tokens: 8000 },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      return NextResponse.json({ error: `Claude API error (${res.status}): ${err.substring(0, 200)}` }, { status: 500 })
    }

    const data = await res.json()
    // With extended thinking, extract only text blocks (skip thinking blocks)
    const raw = data.content
      ?.filter((c: { type: string }) => c.type === 'text')
      .map((c: { text?: string }) => c.text || '')
      .join('').trim() || ''
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

    let result: {
      allSlides?: string[]; slides?: string[]; dolor: string; angulos: string[]; slideCount?: number
      totalStoriesInGrid?: number; sequencePositions?: number[]
      excluded?: string[]; gridInfo?: { headerHeightPercent: number; rows: number; cols: number }
    }
    try {
      result = JSON.parse(cleaned)
    } catch {
      return NextResponse.json({ error: 'Failed to parse AI response', raw: cleaned }, { status: 500 })
    }
    // Normalize: AI should return allSlides, but fallback to slides
    if (!result.allSlides && result.slides) result.allSlides = result.slides
    result.slideCount = result.allSlides?.length || 0

    // Auto-create new dolores/angulos in master lists
    if (result.dolor && !dolores.includes(result.dolor)) {
      await supabase.from('master_lists').upsert(
        { user_id: user.id, category: 'dolores', items: [...dolores, result.dolor], updated_at: new Date().toISOString() },
        { onConflict: 'user_id,category' }
      )
    }
    const newAngulos = (result.angulos || []).filter(a => a && !angulos.includes(a))
    if (newAngulos.length > 0) {
      await supabase.from('master_lists').upsert(
        { user_id: user.id, category: 'angulos', items: [...angulos, ...newAngulos], updated_at: new Date().toISOString() },
        { onConflict: 'user_id,category' }
      )
    }

    return NextResponse.json({ success: true, ...result })
  } catch (e) {
    return NextResponse.json({ error: `Analysis failed: ${(e as Error).message}` }, { status: 500 })
  }
}
