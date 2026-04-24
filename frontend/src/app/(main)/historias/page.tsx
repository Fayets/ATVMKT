'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useMonthContext } from '@/shared/components/app-providers'
import { MonthSelector } from '@/shared/components/month-selector'
import { useToast } from '@/shared/components/toast'
import { useSupabase } from '@/shared/hooks/use-supabase'
import { getMonthRange, formatCash } from '@/shared/lib/supabase/queries'
import { Bar, Line } from '@/shared/components/charts'

type StorySlide = {
  id: string; metrics: Record<string, number | string>; published_at: string | null; url: string | null
}

type Secuencia = {
  fecha: string; slides: StorySlide[]; totalViews: number; totalReplies: number
  metaId?: string; dolor: string; angulos: string[]; cta: string; chats: number; cash: number; notes: string; secuenciaDesc: string
}

type YTVideo = { id: string; title: string }
const UNDO_DURATION = 6000

export default function HistoriasPage() {
  const { month, options, setMonth } = useMonthContext()
  const { toast } = useToast()
  const { supabase, ready, userId } = useSupabase()
  const [rawStories, setRawStories] = useState<StorySlide[]>([])
  const [secuenciaMetas, setSecuenciaMetas] = useState<Record<string, { id: string; classification: Record<string, unknown>; chats: number; cash: number; notes: string; thumbnails: string[] }>>({})
  const [ytVideos, setYtVideos] = useState<YTVideo[]>([])
  const [loading, setLoading] = useState(true)
  const [masterLists, setMasterLists] = useState<{ dolores: string[]; angulos: string[]; ctas: string[] }>({ dolores: [], angulos: [], ctas: [] })
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, string>>({ chats: '0', cash: '0' })
  const [formAngulos, setFormAngulos] = useState<string[]>([])
  const [formSlides, setFormSlides] = useState<string[]>([])
  const [formSlideThumbs, setFormSlideThumbs] = useState<string[]>([])
  const [formSelected, setFormSelected] = useState<Set<number>>(new Set())
  const [analyzing, setAnalyzing] = useState(false)
  const [showManualForm, setShowManualForm] = useState(false)

  // Undo
  const [undoAction, setUndoAction] = useState<{ label: string; execute: () => Promise<void> } | null>(null)
  const [undoProgress, setUndoProgress] = useState(100)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const undoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const showUndo = (label: string, fn: () => Promise<void>) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    if (undoIntervalRef.current) clearInterval(undoIntervalRef.current)
    setUndoAction({ label, execute: fn }); setUndoProgress(100)
    const start = Date.now()
    undoIntervalRef.current = setInterval(() => { const r = Math.max(0, 100 - ((Date.now() - start) / UNDO_DURATION) * 100); setUndoProgress(r); if (r <= 0) { clearInterval(undoIntervalRef.current!); setUndoAction(null) } }, 50)
    undoTimerRef.current = setTimeout(() => { if (undoIntervalRef.current) clearInterval(undoIntervalRef.current); setUndoAction(null) }, UNDO_DURATION)
  }
  const handleUndo = async () => { if (!undoAction) return; if (undoTimerRef.current) clearTimeout(undoTimerRef.current); if (undoIntervalRef.current) clearInterval(undoIntervalRef.current); await undoAction.execute(); setUndoAction(null); toast('Revertido'); fetchData() }

  const fetchData = useCallback(async () => {
    if (!ready) return; setLoading(true)
    const { start, end } = getMonthRange(month)
    const [storiesRes, secRes, listsRes, ytRes] = await Promise.all([
      supabase.from('content_items').select('id, metrics, published_at, url').in('content_type', ['story']).eq('platform', 'instagram').gte('published_at', start).lte('published_at', end).order('published_at', { ascending: true }),
      supabase.from('content_items').select('id, classification, chats, cash, notes, metrics, published_at').eq('content_type', 'historia').eq('platform', 'instagram').gte('published_at', start).lte('published_at', end),
      supabase.from('master_lists').select('category, items'),
      supabase.from('content_items').select('id, title').eq('content_type', 'video').eq('platform', 'youtube').order('published_at', { ascending: false }).limit(50),
    ])
    setRawStories((storiesRes.data as StorySlide[]) || [])
    setYtVideos((ytRes.data as YTVideo[]) || [])
    const metas: Record<string, { id: string; classification: Record<string, unknown>; chats: number; cash: number; notes: string; thumbnails: string[] }> = {}
    ;(secRes.data || []).forEach((r: Record<string, unknown>) => {
      const fecha = String(r.published_at || '').split('T')[0]
      const metrics = (r.metrics as Record<string, unknown>) || {}
      const thumbs = Array.isArray(metrics.thumbnails) ? metrics.thumbnails as string[] : []
      if (fecha) metas[fecha] = { id: r.id as string, classification: (r.classification as Record<string, unknown>) || {}, chats: Number(r.chats) || 0, cash: Number(r.cash) || 0, notes: String(r.notes || ''), thumbnails: thumbs }
    })
    setSecuenciaMetas(metas)
    const lists: Record<string, string[]> = {}
    ;(listsRes.data || []).forEach((r: { category: string; items: unknown }) => { lists[r.category] = Array.isArray(r.items) ? r.items as string[] : [] })
    setMasterLists({ dolores: lists.dolores || [], angulos: lists.angulos || [], ctas: lists.ctas || [] })
    setLoading(false)
  }, [month, ready, supabase])

  useEffect(() => { fetchData() }, [fetchData])

  // Auto-classify unclassified secuencias on page load (once per session)
  const [autoClassified, setAutoClassified] = useState(false)
  useEffect(() => {
    if (!ready || autoClassified || loading) return
    setAutoClassified(true)
    fetch('/api/classify-all-secuencias', { method: 'POST' })
      .then(r => r.json())
      .then(d => { if (d.classified > 0) { toast(`${d.classified} secuencias clasificadas con IA`); fetchData() } })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, loading, autoClassified])

  // Group stories by date -> secuencias (includes manual secuencias without Metricool stories)
  const secuencias: Secuencia[] = useMemo(() => {
    const byDate: Record<string, StorySlide[]> = {}
    rawStories.forEach(s => {
      const fecha = s.published_at?.split('T')[0] || 'unknown'
      if (!byDate[fecha]) byDate[fecha] = []
      byDate[fecha].push(s)
    })
    Object.keys(secuenciaMetas).forEach(fecha => { if (!byDate[fecha]) byDate[fecha] = [] })
    return Object.entries(byDate).sort(([a], [b]) => b.localeCompare(a)).map(([fecha, slides]) => {
      const meta = secuenciaMetas[fecha]
      const cls = (meta?.classification || {}) as Record<string, unknown>
      return {
        fecha, slides,
        totalViews: slides.reduce((s, sl) => s + (Number(sl.metrics?.views) || Number(sl.metrics?.impressions) || 0), 0),
        totalReplies: slides.reduce((s, sl) => s + (Number(sl.metrics?.replies) || 0), 0),
        metaId: meta?.id, dolor: String(cls.dolor || ''),
        angulos: Array.isArray(cls.angulos) ? cls.angulos as string[] : [],
        cta: String(cls.cta || ''), chats: meta?.chats || 0, cash: meta?.cash || 0,
        notes: meta?.notes || '', secuenciaDesc: String(cls.secuencia || ''),
      }
    })
  }, [rawStories, secuenciaMetas])

  // Sync Metricool
  const handleSync = async () => {
    const { data: conn } = await supabase.from('api_connections').select('credentials').eq('platform', 'metricool').maybeSingle()
    const creds = conn?.credentials as Record<string, string> | null
    if (!creds?.user_token || !creds?.user_id || !creds?.blog_id) { toast('Configura Metricool en Conexiones API'); return }
    const [y, m] = month.split('-').map(Number)
    setSyncing(true); setSyncStatus('Conectando...')
    try {
      const res = await fetch('/api/sync/metricool', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userToken: creds.user_token, userId: creds.user_id, blogId: creds.blog_id, startDate: `${y}-${String(m).padStart(2, '0')}-01`, endDate: `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}` }) })
      const data = await res.json()
      if (data.error) { setSyncStatus(`Error: ${data.error}`) }
      else {
        setSyncStatus(`${data.posts} reels + ${data.stories} stories + ${data.secuencias || 0} secuencias. ${data.new} nuevos.`)
        toast('Sync completado'); await fetchData()
        setSyncStatus(prev => prev + ' Clasificando con IA...')
        await autoClassify()
        setSyncStatus(prev => prev.replace('Clasificando con IA...', 'Clasificacion completada'))
      }
    } catch (e) { setSyncStatus(`Error: ${(e as Error).message}`) }
    setSyncing(false)
  }

  // Auto-classify all unclassified secuencias via server-side Vision API
  const autoClassify = async () => {
    try {
      await fetch('/api/classify-all-secuencias', { method: 'POST' })
    } catch { /* skip */ }
    fetchData()
  }

  // Crop stories from screenshot using AI grid info
  const cropStoriesFromImage = (imgSrc: string, gridInfo: { headerHeightPercent: number; rows: number; cols: number }, positions: number[]): Promise<string[]> => {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const cols = gridInfo.cols || 3
        const headerOffset = Math.floor(img.height * (gridInfo.headerHeightPercent || 15) / 100)
        const gridHeight = img.height - headerOffset
        const rows = gridInfo.rows || Math.ceil(gridHeight / (img.width / cols * 16 / 9))
        const cellW = Math.floor(img.width / cols)
        const cellH = Math.floor(gridHeight / rows)
        const padX = Math.floor(cellW * 0.02)
        const padY = Math.floor(cellH * 0.02)
        const thumbs: string[] = []
        for (const pos of positions) {
          const idx = pos - 1
          const row = Math.floor(idx / cols)
          const col = idx % cols
          const x = col * cellW + padX
          const y = headerOffset + row * cellH + padY
          const w = cellW - padX * 2
          const h = Math.min(cellH - padY * 2, img.height - y)
          if (y >= img.height || w <= 0 || h <= 0) continue
          const canvas = document.createElement('canvas')
          canvas.width = w; canvas.height = h
          const ctx = canvas.getContext('2d')!
          ctx.drawImage(img, x, y, w, h, 0, 0, w, h)
          thumbs.push(canvas.toDataURL('image/jpeg', 0.7))
        }
        resolve(thumbs)
      }
      img.src = imgSrc
    })
  }

  // Analyze screenshot
  const handleScreenshot = async (file: File) => {
    setAnalyzing(true)
    try {
      const reader = new FileReader()
      const dataUrl = await new Promise<string>((resolve) => { reader.onload = () => resolve(reader.result as string); reader.readAsDataURL(file) })
      const base64 = dataUrl.split(',')[1]
      const res = await fetch('/api/analyze-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageBase64: base64, mediaType: file.type || 'image/jpeg' }) })
      const data = await res.json()
      if (data.success) {
        const seqPositions: number[] = data.sequencePositions || []
        const allDescs: string[] = data.allSlides || data.slides || []
        const total = data.totalStoriesInGrid || allDescs.length
        setForm(prev => ({ ...prev, dolor: data.dolor || '', fecha: prev.fecha || new Date().toISOString().split('T')[0] }))
        setFormAngulos(data.angulos || [])
        setFormSlides(allDescs)
        setFormSelected(new Set(seqPositions))
        const gridInfo = data.gridInfo || { headerHeightPercent: 15, rows: 3, cols: 3 }
        const allPositions = Array.from({ length: total }, (_, i) => i + 1)
        const thumbs = await cropStoriesFromImage(dataUrl, gridInfo, allPositions)
        setFormSlideThumbs(thumbs)
        toast(`IA detecto ${seqPositions.length} de ${total} stories`)
        fetchData()
      } else { toast(`Error IA: ${data.error}`) }
    } catch (e) { toast(`Error: ${(e as Error).message}`) }
    setAnalyzing(false)
  }

  // Save new secuencia (manual)
  const saveNewSecuencia = async () => {
    if (!userId || !form.fecha) { toast('Pone la fecha'); return }
    const selectedDescs = formSlides.filter((_, i) => formSelected.has(i + 1)).filter(s => s.trim())
    if (selectedDescs.length === 0) { toast('Selecciona al menos una story'); return }
    const secuenciaStr = selectedDescs.join(' -> ')
    const selectedThumbs = formSlideThumbs.filter((_, i) => formSelected.has(i + 1))
    const { error } = await supabase.from('content_items').insert({
      user_id: userId, content_type: 'historia', platform: 'instagram',
      title: `Secuencia ${form.fecha} (${selectedDescs.length} stories)`,
      classification: { dolor: form.dolor || '', angulos: formAngulos, cta: form.cta || '', secuencia: secuenciaStr },
      chats: Number(form.chats) || 0, cash: Number(form.cash) || 0, metrics: { thumbnails: selectedThumbs },
      published_at: `${form.fecha}T12:00:00`, notes: secuenciaStr,
    })
    if (error) { toast(`Error al guardar: ${error.message}`); return }
    toast('Secuencia agregada')
    setForm({ chats: '0', cash: '0' }); setFormAngulos([]); setFormSlides([]); setFormSlideThumbs([]); setFormSelected(new Set()); setShowManualForm(false)
    fetchData()
  }

  // Save secuencia metadata (inline edit)
  const saveSecuencia = async (fecha: string) => {
    if (!userId) return
    const existing = secuenciaMetas[fecha]
    const row = {
      classification: { dolor: form.dolor || '', angulos: formAngulos, cta: form.cta || '', secuencia: form.secuenciaDesc || '' },
      chats: Number(form.chats) || 0, cash: Number(form.cash) || 0, notes: form.notes || '',
      published_at: `${fecha}T12:00:00`, updated_at: new Date().toISOString(),
    }
    if (existing) {
      const snap = { ...existing }
      await supabase.from('content_items').update(row).eq('id', existing.id)
      showUndo('Secuencia editada', async () => { await supabase.from('content_items').update({ classification: snap.classification, chats: snap.chats, cash: snap.cash, notes: snap.notes, updated_at: new Date().toISOString() }).eq('id', snap.id) })
    } else {
      await supabase.from('content_items').insert({ ...row, user_id: userId, content_type: 'historia', platform: 'instagram', metrics: {} })
    }
    toast('Secuencia guardada')
    setExpanded(null); setForm({ chats: '0', cash: '0' }); setFormAngulos([])
    fetchData()
  }

  const startEdit = (sec: Secuencia) => {
    setExpanded(sec.fecha)
    setForm({ dolor: sec.dolor, cta: sec.cta, chats: String(sec.chats), cash: String(sec.cash), notes: sec.notes, secuenciaDesc: sec.secuenciaDesc })
    setFormAngulos(sec.angulos)
  }

  // Master list creators
  const addToList = async (category: 'dolores' | 'angulos' | 'ctas', value: string) => {
    if (!value.trim() || !userId) return
    const updated = [...masterLists[category], value.trim()]
    await supabase.from('master_lists').upsert({ user_id: userId, category, items: updated, updated_at: new Date().toISOString() }, { onConflict: 'user_id,category' })
    setMasterLists(prev => ({ ...prev, [category]: updated }))
    toast('Creado')
  }

  const totalChats = secuencias.reduce((s, sec) => s + sec.chats, 0)
  const conCTA = secuencias.filter(s => s.cta).length
  const sinCTA = secuencias.filter(s => !s.cta).length

  if (!ready || loading) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Historias</h2>
        <MonthSelector month={month} options={options} onChange={setMonth} />
      </div>

      {/* Stats row — 4 cards */}
      <div className="mb-6 grid grid-cols-4 gap-4">
        <div className="glass-card p-5">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Chats del mes</div>
          <div className="font-mono-num mt-1 text-3xl font-bold">{totalChats}</div>
        </div>
        <div className="glass-card p-5">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Secuencias con CTA</div>
          <div className="font-mono-num mt-1 text-3xl font-bold">{conCTA}</div>
        </div>
        <div className="glass-card p-5 border-[var(--accent)]">
          <div className="text-[10px] text-[var(--accent)] uppercase tracking-wider">Secuencias sin CTA</div>
          <div className="font-mono-num mt-1 text-3xl font-bold text-[var(--accent)]">{sinCTA}</div>
        </div>
        <div className="glass-card p-5">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Stories sincronizadas</div>
          <div className="font-mono-num mt-1 text-3xl font-bold">{rawStories.length}</div>
        </div>
      </div>

      {/* Sync + manual add */}
      <div className="mb-4 flex items-center gap-3">
        <button onClick={handleSync} disabled={syncing} className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase text-white hover:opacity-90 disabled:opacity-30">
          {syncing ? 'Sincronizando...' : 'Sincronizar Metricool'}
        </button>
        {!showManualForm && (
          <button onClick={() => setShowManualForm(true)} className="rounded-lg border border-[var(--border2)] px-5 py-2.5 text-[11px] font-semibold uppercase text-[var(--text2)] hover:border-[var(--accent)] hover:text-[var(--accent)]">
            + Agregar secuencia manualmente
          </button>
        )}
      </div>
      {syncStatus && <div className={`mb-4 text-[12px] ${syncStatus.startsWith('Error') ? 'text-[var(--red)]' : 'text-[var(--text3)]'}`}>{syncStatus}</div>}

      {/* Manual secuencia form (overlay section) */}
      {showManualForm && (
        <div className="glass-card p-6 mb-6 border-[var(--accent)]">
          <div className="text-[11px] font-medium uppercase tracking-widest text-[var(--text3)] mb-4">Nueva secuencia de historias</div>
          {/* Screenshot upload */}
          <div className="mb-4 glass-card p-5 relative accent-top">
            <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--accent)] mb-3">Subir screenshot de historias (la IA analiza automaticamente)</div>
            <label className={`block min-h-[80px] rounded-lg border-2 border-dashed ${analyzing ? 'border-[var(--accent)]' : 'border-[var(--border2)]'} bg-[var(--bg3)] flex items-center justify-center cursor-pointer hover:border-[var(--accent)] transition-all`}>
              <input type="file" accept="image/*" className="hidden" onChange={e => { if (e.target.files?.[0]) handleScreenshot(e.target.files[0]) }} />
              <div className="text-center p-4">
                {analyzing ? <div className="text-[var(--accent)] text-[13px]">Analizando con IA...</div>
                  : formSlides.length > 0 ? <div className="text-[var(--green)] text-[13px]">{formSlides.length} slides detectados — subi otra imagen para reanalizar</div>
                  : <><div className="text-[13px] text-[var(--text3)]">Subi o arrastra el screenshot de tus historias</div><div className="text-[10px] text-[var(--text3)] mt-1">.JPG, .PNG</div></>}
              </div>
            </label>
          </div>
          {/* Slide thumbnails — click to select/deselect */}
          {formSlides.length > 0 && (
            <div className="mb-4">
              <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
                Click para seleccionar/deseleccionar stories ({formSelected.size} de {formSlides.length})
              </label>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {formSlides.map((_, i) => {
                  const pos = i + 1
                  const isSelected = formSelected.has(pos)
                  return (
                    <button key={i} type="button" onClick={() => setFormSelected(prev => { const next = new Set(prev); if (next.has(pos)) next.delete(pos); else next.add(pos); return next })}
                      className={`flex-shrink-0 w-20 rounded-lg overflow-hidden transition-all cursor-pointer ${isSelected ? 'border-2 border-[var(--accent)] ring-2 ring-[var(--accent)] ring-opacity-30' : 'border border-[var(--border)] opacity-40 hover:opacity-70'}`}>
                      {formSlideThumbs[i] ? <img src={formSlideThumbs[i]} alt={`Slide ${pos}`} className="w-full h-36 object-cover" />
                        : <div className="w-full h-36 bg-[var(--bg4)] flex items-center justify-center text-[var(--text3)] text-lg font-bold">{pos}</div>}
                      <div className={`px-2 py-1.5 text-center ${isSelected ? 'bg-[var(--accent)]' : 'bg-[var(--bg3)]'}`}>
                        <div className={`text-[9px] font-semibold ${isSelected ? 'text-white' : 'text-[var(--text3)]'}`}>{pos}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          {/* Form fields */}
          <div className="grid grid-cols-5 gap-3 mb-3">
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Dolor</label>
              <select value={form.dolor || ''} onChange={async e => { if (e.target.value === '__new__') { const v = prompt('Nuevo dolor:'); if (v) { await addToList('dolores', v); setForm(p => ({ ...p, dolor: v.trim() })) } } else setForm(p => ({ ...p, dolor: e.target.value })) }}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none cursor-pointer">
                <option value="">Seleccionar...</option>
                {masterLists.dolores.map(d => <option key={d} value={d}>{d}</option>)}
                <option value="__new__">+ Crear nuevo...</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Angulos</label>
              <div className="min-h-[38px] rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-2 py-1.5 flex flex-wrap gap-1 items-center">
                {formAngulos.map(a => (
                  <span key={a} className="inline-flex items-center gap-1 rounded-full bg-[var(--bg4)] px-2.5 py-1 text-[11px]">
                    {a} <button type="button" onClick={() => setFormAngulos(p => p.filter(x => x !== a))} className="text-[var(--text3)] hover:text-[var(--red)]">x</button>
                  </span>
                ))}
                <AnguloSelect angulos={masterLists.angulos} selected={formAngulos} onAdd={v => setFormAngulos(p => [...p, v])} onCreateNew={async () => { const v = prompt('Nuevo angulo:'); if (v) { await addToList('angulos', v); setFormAngulos(p => [...p, v.trim()]) } }} />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Fecha</label>
              <input type="date" value={form.fecha || ''} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">CTA</label>
              <select value={form.cta || ''} onChange={async e => { if (e.target.value === '__new__') { const v = prompt('Nuevo CTA:'); if (v) { await addToList('ctas', v); setForm(p => ({ ...p, cta: v.trim() })) } } else setForm(p => ({ ...p, cta: e.target.value })) }}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none cursor-pointer">
                <option value="">Seleccionar...</option>
                {ytVideos.length > 0 && <optgroup label="Videos de YouTube">{ytVideos.map(v => <option key={v.id} value={`YT: ${v.title}`}>{v.title}</option>)}</optgroup>}
                {masterLists.ctas.length > 0 && <optgroup label="CTAs">{masterLists.ctas.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>}
                <option value="__new__">+ Crear nuevo...</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Chats</label>
              <input type="number" value={form.chats || '0'} onChange={e => setForm(p => ({ ...p, chats: e.target.value }))} className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none" />
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={saveNewSecuencia} className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase text-white hover:opacity-90">+ Agregar Secuencia</button>
            <button onClick={() => { setShowManualForm(false); setForm({ chats: '0', cash: '0' }); setFormAngulos([]); setFormSlides([]); setFormSlideThumbs([]); setFormSelected(new Set()) }} className="rounded-lg border border-[var(--border2)] px-5 py-2.5 text-[11px] font-semibold uppercase text-[var(--text3)]">Cancelar</button>
          </div>
        </div>
      )}

      {/* Secuencias list */}
      {secuencias.length === 0 ? (
        <div className="py-12 text-center text-[13px] text-[var(--text3)]">No hay historias este mes. Apreta &quot;Sincronizar Metricool&quot; para importar.</div>
      ) : (
        <div className="space-y-4">
          {secuencias.map(sec => {
            const isExpanded = expanded === sec.fecha
            const cpc = sec.chats > 0 ? sec.cash / sec.chats : 0
            const metaThumbs = secuenciaMetas[sec.fecha]?.thumbnails || []
            const hasSlides = sec.slides.length > 0
            const hasThumbs = metaThumbs.length > 0
            const slideCount = hasSlides ? sec.slides.length : hasThumbs ? metaThumbs.length : 0

            return (
              <div key={sec.fecha} className={`glass-card p-5 transition-all ${isExpanded ? 'border-[var(--accent)]' : 'cursor-pointer hover:border-[var(--border2)]'}`}
                onClick={() => { if (!isExpanded) startEdit(sec) }}>
                {/* Header with date + metrics */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-4">
                    <div className="text-[14px] font-semibold">{sec.fecha}</div>
                    <span className="font-mono-num text-[12px] text-[var(--text2)]">VISITAS: {sec.totalViews.toLocaleString()}</span>
                    <span className="font-mono-num text-[12px] text-[var(--text2)]">CASH: {formatCash(sec.cash)}</span>
                    <span className="font-mono-num text-[12px] text-[var(--text2)]">CHATS: {sec.chats}</span>
                    <span className="font-mono-num text-[12px] text-[var(--text2)]">CPC: {formatCash(cpc)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {sec.metaId && !isExpanded && (
                      <button onClick={async (e) => {
                        e.stopPropagation()
                        if (!confirm(`Eliminar secuencia del ${sec.fecha}?`)) return
                        const snap = { ...sec }
                        await supabase.from('content_items').delete().eq('id', sec.metaId!)
                        toast('Secuencia eliminada')
                        showUndo('Secuencia eliminada', async () => {
                          await supabase.from('content_items').insert({
                            id: snap.metaId, user_id: userId, content_type: 'historia', platform: 'instagram',
                            classification: { dolor: snap.dolor, angulos: snap.angulos, cta: snap.cta, secuencia: snap.secuenciaDesc },
                            chats: snap.chats, cash: snap.cash, notes: snap.notes, metrics: {},
                            published_at: `${snap.fecha}T12:00:00`,
                          })
                        })
                        if (expanded === sec.fecha) setExpanded(null)
                        fetchData()
                      }} className="text-[var(--text3)] hover:text-[var(--red)] text-[13px]" title="Eliminar">✕</button>
                    )}
                    {isExpanded && (
                      <button onClick={(e) => { e.stopPropagation(); setExpanded(null); setForm({ chats: '0', cash: '0' }); setFormAngulos([]) }} className="text-[var(--text3)] hover:text-[var(--text)] text-[13px]" title="Cerrar">✕</button>
                    )}
                  </div>
                </div>

                {/* Slide strip — only visible when collapsed */}
                {!isExpanded && hasSlides ? (
                  <div className="flex gap-2 overflow-x-auto pb-2 mb-3">
                    {sec.slides.map((slide, i) => {
                      const thumb = slide.metrics?.thumbnail as string
                      return (
                        <div key={slide.id} className="flex-shrink-0 w-20 h-36 rounded-lg bg-[var(--bg4)] border border-[var(--border)] overflow-hidden relative">
                          {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-[var(--text3)] text-[10px]">{i + 1}</div>}
                          <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-center text-[8px] text-white py-0.5">{i + 1}/{slideCount}</div>
                        </div>
                      )
                    })}
                  </div>
                ) : !isExpanded && hasThumbs ? (
                  <div className="flex gap-2 overflow-x-auto pb-2 mb-3">
                    {metaThumbs.map((thumb, i) => (
                      <div key={i} className="flex-shrink-0 w-20 h-36 rounded-lg bg-[var(--bg4)] border border-[var(--border)] overflow-hidden relative">
                        <img src={thumb} alt={`Slide ${i + 1}`} className="w-full h-full object-cover" />
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-center text-[8px] text-white py-0.5">{i + 1}/{slideCount}</div>
                      </div>
                    ))}
                  </div>
                ) : !isExpanded ? (
                  <div className="mb-3 text-[11px] text-[var(--text3)] italic">Secuencia manual — sin preview</div>
                ) : null}

                {/* Classification tags (collapsed view) */}
                {!isExpanded && (
                  <div className="flex flex-wrap gap-2 items-center">
                    {sec.dolor && <span className="rounded bg-[rgba(230,57,70,0.15)] px-2.5 py-1 text-[10px] text-[var(--red)] font-medium">DOLOR: {sec.dolor}</span>}
                    {sec.angulos.map(a => <span key={a} className="rounded bg-[rgba(245,158,11,0.15)] px-2.5 py-1 text-[10px] text-[var(--amber)] font-medium">ANGULO: {a}</span>)}
                    {sec.cta && <span className="rounded bg-[rgba(59,130,246,0.15)] px-2.5 py-1 text-[10px] text-[var(--blue)] font-medium">CTA: {sec.cta}</span>}
                    {!sec.dolor && !sec.cta && sec.angulos.length === 0 && <span className="text-[11px] text-[var(--text3)] italic">Sin clasificar — click para editar</span>}
                  </div>
                )}

                {/* Expanded: full detail view */}
                {isExpanded && (() => {
                  // Build slide data from Metricool stories OR base64 thumbnails
                  const slideMetrics = hasSlides
                    ? sec.slides.map((s, i) => ({
                        idx: i + 1,
                        views: Number(s.metrics?.views || s.metrics?.impressions || 0),
                        likes: Number(s.metrics?.replies || 0),
                        reach: Number(s.metrics?.reach || 0),
                        thumb: (s.metrics?.thumbnail as string) || null,
                      }))
                    : metaThumbs.map((t, i) => ({
                        idx: i + 1,
                        views: 0,
                        likes: 0,
                        reach: 0,
                        thumb: t,
                      }))
                  const maxViews = Math.max(...slideMetrics.map(s => s.views), 1)
                  const retentionData = slideMetrics.map(s => maxViews > 0 ? (s.views / maxViews) * 100 : 100)
                  const hasMetrics = slideMetrics.some(s => s.views > 0)

                  return (
                  <div className="mt-4 pt-4 border-t border-[var(--border)]" onClick={e => e.stopPropagation()}>
                    {/* KPIs */}
                    <div className="grid grid-cols-3 gap-3 mb-5">
                      <div className="rounded-lg bg-[var(--bg4)] p-4 text-center">
                        <div className="text-[9px] uppercase tracking-wider text-[var(--text3)]">Cash Generado</div>
                        <input type="number" value={form.cash || '0'} onChange={e => setForm(p => ({ ...p, cash: e.target.value }))}
                          className="w-full bg-transparent text-center font-mono-num text-2xl font-bold text-[var(--green)] outline-none" />
                      </div>
                      <div className="rounded-lg bg-[var(--bg4)] p-4 text-center">
                        <div className="text-[9px] uppercase tracking-wider text-[var(--text3)]">Chats</div>
                        <input type="number" value={form.chats || '0'} onChange={e => setForm(p => ({ ...p, chats: e.target.value }))}
                          className="w-full bg-transparent text-center font-mono-num text-2xl font-bold text-[var(--text)] outline-none" />
                      </div>
                      <div className="rounded-lg bg-[var(--bg4)] p-4 text-center">
                        <div className="text-[9px] uppercase tracking-wider text-[var(--text3)]">Cash por Chat</div>
                        <div className="font-mono-num text-2xl font-bold">
                          {Number(form.chats) > 0 ? formatCash(Number(form.cash) / Number(form.chats)) : '$0'}
                        </div>
                      </div>
                    </div>

                    {/* Stories with thumbnails + dropoff between them */}
                    {slideMetrics.length > 0 && (
                      <div className="mb-5">
                        <div className="flex items-end overflow-x-auto pb-2">
                          {slideMetrics.map((s, i) => {
                            const dropoff = i > 0 && slideMetrics[i - 1].views > 0
                              ? Math.round(((slideMetrics[i - 1].views - s.views) / slideMetrics[i - 1].views) * 100)
                              : 0
                            return (
                              <div key={s.idx} className="flex items-end flex-1 min-w-0">
                                {/* Dropoff between stories */}
                                {i > 0 && hasMetrics && (
                                  <div className="flex flex-col items-center justify-center w-6 flex-shrink-0 mb-14">
                                    <div className={`text-[9px] font-mono-num font-bold ${dropoff > 10 ? 'text-[var(--red)]' : 'text-[var(--text3)]'}`}>
                                      {dropoff > 0 ? `-${dropoff}%` : '0%'}
                                    </div>
                                  </div>
                                )}
                                {!hasMetrics && i > 0 && (
                                  <div className="w-2 flex-shrink-0" />
                                )}
                                {/* Story card — fills available space */}
                                <div className="flex-1 min-w-0 text-center">
                                  <div className="aspect-[9/16] rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--bg4)] mb-1.5">
                                    {s.thumb ? <img src={s.thumb} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-[var(--text3)] text-lg font-bold">{s.idx}</div>}
                                  </div>
                                  {hasMetrics && (
                                    <>
                                      <div className="text-[9px] text-[var(--text3)]">Vistas: <span className="font-mono-num text-[var(--text)]">{s.views.toLocaleString()}</span></div>
                                      <div className="text-[9px] text-[var(--text3)]">Replies: <span className="font-mono-num text-[var(--text)]">{s.likes}</span></div>
                                      <div className="text-[9px] text-[var(--text3)]">Alcance: <span className="font-mono-num text-[var(--text)]">{s.reach.toLocaleString()}</span></div>
                                    </>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Classification — Dolor, Angulo, CTA */}
                    <div className="grid grid-cols-3 gap-3 mb-5">
                      <div>
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Dolor</label>
                        <select value={form.dolor || ''} onChange={async e => { if (e.target.value === '__new__') { const v = prompt('Nuevo dolor:'); if (v) { await addToList('dolores', v); setForm(p => ({ ...p, dolor: v.trim() })) } } else setForm(p => ({ ...p, dolor: e.target.value })) }}
                          className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none cursor-pointer">
                          <option value="">Seleccionar...</option>
                          {masterLists.dolores.map(d => <option key={d} value={d}>{d}</option>)}
                          <option value="__new__">+ Crear nuevo...</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Angulos</label>
                        <div className="min-h-[38px] rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-2 py-1.5 flex flex-wrap gap-1 items-center">
                          {formAngulos.map(a => (
                            <span key={a} className="inline-flex items-center gap-1 rounded-full bg-[rgba(245,158,11,0.15)] px-2.5 py-1 text-[11px] text-amber-400">
                              {a} <button type="button" onClick={() => setFormAngulos(p => p.filter(x => x !== a))} className="text-[var(--text3)] hover:text-[var(--red)]">×</button>
                            </span>
                          ))}
                          <AnguloSelect angulos={masterLists.angulos} selected={formAngulos} onAdd={v => setFormAngulos(p => [...p, v])} onCreateNew={async () => { const v = prompt('Nuevo angulo:'); if (v) { await addToList('angulos', v); setFormAngulos(p => [...p, v.trim()]) } }} />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">CTA</label>
                        <select value={form.cta || ''} onChange={async e => { if (e.target.value === '__new__') { const v = prompt('Nuevo CTA:'); if (v) { await addToList('ctas', v); setForm(p => ({ ...p, cta: v.trim() })) } } else setForm(p => ({ ...p, cta: e.target.value })) }}
                          className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none cursor-pointer">
                          <option value="">Seleccionar...</option>
                          {ytVideos.length > 0 && <optgroup label="Videos de YouTube">{ytVideos.map(v => <option key={v.id} value={`YT: ${v.title}`}>▶ {v.title}</option>)}</optgroup>}
                          {masterLists.ctas.length > 0 && <optgroup label="CTAs">{masterLists.ctas.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>}
                          <option value="__new__">+ Crear nuevo...</option>
                        </select>
                      </div>
                    </div>

                    {/* Retention chart — only when we have real metrics */}
                    {hasMetrics && slideMetrics.length > 1 && (
                      <div className="mb-5">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)] mb-2">Grafico de Retencion</div>
                        <div className="h-32">
                          <Line data={{
                            labels: slideMetrics.map(s => `S${s.idx}`),
                            datasets: [{
                              data: retentionData,
                              borderColor: '#E63946',
                              backgroundColor: 'rgba(230,57,70,0.1)',
                              fill: true, tension: 0.3, pointRadius: 3,
                              pointBackgroundColor: '#E63946', borderWidth: 2,
                            }],
                          }} options={{
                            responsive: true, maintainAspectRatio: false,
                            scales: {
                              x: { grid: { display: false }, ticks: { color: '#A1A1AA', font: { size: 9 } } },
                              y: { min: 0, max: 100, ticks: { callback: (v) => `${v}%`, color: '#52525B', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.03)' } },
                            },
                            plugins: { tooltip: { callbacks: { label: (ctx) => `${Number(ctx.raw).toFixed(1)}% retencion` } }, legend: { display: false } },
                          }} />
                        </div>
                      </div>
                    )}

                    {/* Save / Close */}
                    <div className="flex gap-3">
                      <button onClick={() => saveSecuencia(sec.fecha)} className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase text-white hover:opacity-90">Guardar</button>
                      <button onClick={() => { setExpanded(null); setForm({ chats: '0', cash: '0' }); setFormAngulos([]) }} className="rounded-lg border border-[var(--border2)] px-5 py-2.5 text-[11px] font-semibold uppercase text-[var(--text3)]">Cerrar</button>
                    </div>
                  </div>
                  )
                })()}
              </div>
            )
          })}
        </div>
      )}

      {/* Undo toast */}
      {undoAction && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] glass-card overflow-hidden shadow-lg border border-[var(--border2)] min-w-[320px]">
          <div className="flex items-center gap-4 px-5 py-3.5">
            <span className="text-[13px] text-[var(--text2)]">{undoAction.label}</span>
            <button onClick={handleUndo} className="rounded-lg bg-[var(--accent)] px-4 py-1.5 text-[11px] font-semibold uppercase text-white">Deshacer</button>
            <button onClick={() => { setUndoAction(null); if (undoTimerRef.current) clearTimeout(undoTimerRef.current); if (undoIntervalRef.current) clearInterval(undoIntervalRef.current) }} className="text-[var(--text3)] text-sm">x</button>
          </div>
          <div className="h-[3px] bg-[var(--bg4)]"><div className="h-full bg-[var(--accent)] transition-[width] duration-[50ms] ease-linear" style={{ width: `${undoProgress}%` }} /></div>
        </div>
      )}
    </div>
  )
}

function AnguloSelect({ angulos, selected, onAdd, onCreateNew }: { angulos: string[]; selected: string[]; onAdd: (v: string) => void; onCreateNew: () => void }) {
  const [val, setVal] = useState('')
  return (
    <select value={val} onChange={e => { if (e.target.value === '__new__') { onCreateNew(); setVal('') } else if (e.target.value && !selected.includes(e.target.value)) { onAdd(e.target.value); setVal('') } else setVal('') }}
      className="bg-transparent text-[11px] text-[var(--text3)] outline-none cursor-pointer border-0 min-w-[80px]">
      <option value="">+ Agregar</option>
      {angulos.filter(a => !selected.includes(a)).map(a => <option key={a} value={a}>{a}</option>)}
      <option value="__new__">+ Crear nuevo...</option>
    </select>
  )
}
