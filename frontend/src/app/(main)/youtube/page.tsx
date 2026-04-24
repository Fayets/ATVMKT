'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useMonthContext } from '@/shared/components/app-providers'
import { MonthSelector } from '@/shared/components/month-selector'
import { useToast } from '@/shared/components/toast'
import { useSupabase } from '@/shared/hooks/use-supabase'
import { getMonthRange, formatK, formatCash } from '@/shared/lib/supabase/queries'

type PerfSnapshot = { date: string; views: number; likes: number; comments: number }
type VideoMetrics = {
  thumbnail?: string; views?: number; likes?: number; comments?: number
  ctr?: number; retention?: number; impressions?: number; avgViewDuration?: number
  performanceHistory?: PerfSnapshot[]
}
type VideoClassification = {
  dolor?: string; angulos?: string[]; cta?: string; transcript?: string
  summary?: string; ctaTranscript?: string; description?: string
  keyPoints?: string[]; targetAudience?: string; mainHook?: string
}
type Video = {
  id: string; title: string | null; metrics: VideoMetrics; classification: VideoClassification
  cash: number; chats: number; published_at: string | null; url: string | null; notes: string | null; external_id: string | null
}
type Lead = { client_name: string | null; status: string | null; payment: number | null; program_purchased: string | null; agenda_point: string | null }

const UNDO_DURATION = 6000

export default function YouTubePage() {
  const { month, options, setMonth } = useMonthContext()
  const { toast } = useToast()
  const { supabase, ready, userId } = useSupabase()
  const [videos, setVideos] = useState<Video[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [prevVideos, setPrevVideos] = useState<Video[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [undoAction, setUndoAction] = useState<{ label: string; execute: () => Promise<void> } | null>(null)
  const [undoProgress, setUndoProgress] = useState(100)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const undoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [analyzingId, setAnalyzingId] = useState<string | null>(null)
  const [transcriptInput, setTranscriptInput] = useState('')
  const [showTranscriptFor, setShowTranscriptFor] = useState<string | null>(null)

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
    const [y, m] = month.split('-').map(Number)
    const prevMonth = `${new Date(y, m - 2, 1).getFullYear()}-${String(new Date(y, m - 2, 1).getMonth() + 1).padStart(2, '0')}`
    const { start: pStart, end: pEnd } = getMonthRange(prevMonth)
    const [res, leadsRes, prevRes] = await Promise.all([
      supabase.from('content_items').select('*').eq('content_type', 'video').eq('platform', 'youtube').gte('published_at', start).lte('published_at', end).order('published_at', { ascending: false }),
      supabase.from('leads').select('client_name, status, payment, program_purchased, agenda_point').eq('month', month),
      supabase.from('content_items').select('*').eq('content_type', 'video').eq('platform', 'youtube').gte('published_at', pStart).lte('published_at', pEnd),
    ])
    setVideos((res.data as Video[]) || [])
    setLeads((leadsRes.data as Lead[]) || [])
    setPrevVideos((prevRes.data as Video[]) || [])
    setLoading(false)
  }, [month, ready, supabase])

  useEffect(() => { fetchData() }, [fetchData])

  const handleSync = async () => {
    const { data: conn } = await supabase.from('api_connections').select('credentials').eq('platform', 'youtube').maybeSingle()
    const creds = conn?.credentials as Record<string, string> | null
    if (!creds?.api_key || !creds?.channel_id) { toast('Configura YouTube en Conexiones API'); return }
    setSyncing(true); setSyncStatus('Sincronizando...')
    try {
      const res = await fetch('/api/sync/youtube', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: creds.api_key, channelId: creds.channel_id }) })
      const data = await res.json()
      if (data.error) setSyncStatus(`Error: ${data.error}`)
      else { setSyncStatus(`${data.total} videos. ${data.new} nuevos, ${data.updated} actualizados.`); toast('Sync completado'); await fetchData() }
    } catch (e) { setSyncStatus(`Error: ${(e as Error).message}`) }
    setSyncing(false)
  }

  const updateField = async (id: string, field: string, value: unknown) => {
    await supabase.from('content_items').update({ [field]: value, updated_at: new Date().toISOString() }).eq('id', id)
    setVideos(prev => prev.map(v => v.id !== id ? v : { ...v, [field]: value }))
  }

  const deleteVideo = async (id: string) => {
    const video = videos.find(v => v.id === id)
    if (!video || !userId || !confirm('Eliminar?')) return
    await supabase.from('content_items').delete().eq('id', id)
    showUndo('Eliminado', async () => { await supabase.from('content_items').insert({ user_id: userId, content_type: 'video', platform: 'youtube', title: video.title, notes: video.notes, classification: video.classification, metrics: video.metrics, published_at: video.published_at, url: video.url, external_id: video.external_id, cash: video.cash, chats: video.chats }) })
    toast('Eliminado'); if (expanded === id) setExpanded(null); fetchData()
  }

  const analyzeVideo = async (video: Video, manualTranscript?: string) => {
    setAnalyzingId(video.id)
    try {
      const res = await fetch('/api/youtube-analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentItemId: video.id, manualTranscript: manualTranscript || undefined }) })
      const data = await res.json()
      if (data.error) toast(`Error: ${data.error}`)
      else { toast(`Analisis completo (fuente: ${data.source})`); setShowTranscriptFor(null); setTranscriptInput(''); fetchData() }
    } catch (e) { toast(`Error: ${(e as Error).message}`) }
    setAnalyzingId(null)
  }

  // Stats
  const totalViews = videos.reduce((s, v) => s + (Number(v.metrics?.views) || 0), 0)
  const prevTotalViews = prevVideos.reduce((s, v) => s + (Number(v.metrics?.views) || 0), 0)
  const totalCash = videos.reduce((s, v) => s + (v.cash || 0), 0)
  const withCtr = videos.filter(v => Number(v.metrics?.ctr) > 0)
  const avgCtr = withCtr.length > 0 ? withCtr.reduce((s, v) => s + Number(v.metrics.ctr), 0) / withCtr.length : 0
  const cashPerVideo = videos.length > 0 ? totalCash / videos.length : 0
  const viewsDelta = prevTotalViews > 0 ? ((totalViews - prevTotalViews) / prevTotalViews * 100).toFixed(0) : null

  if (!ready || loading) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">YouTube <span className="text-[var(--text3)] text-sm font-normal">{month}</span></h2>
        <MonthSelector month={month} options={options} onChange={setMonth} />
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-4 gap-4">
        <div className="glass-card p-5">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Views</div>
          <div className="font-mono-num mt-1 text-2xl font-bold">{formatK(totalViews)}</div>
          {viewsDelta !== null && <div className={`text-[11px] mt-1 font-mono-num ${Number(viewsDelta) >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>{Number(viewsDelta) >= 0 ? '+' : ''}{viewsDelta}% vs mes pasado</div>}
        </div>
        <div className="glass-card p-5">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Videos</div>
          <div className="font-mono-num mt-1 text-2xl font-bold">{videos.length}</div>
        </div>
        <div className="glass-card p-5">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Avg Views</div>
          <div className="font-mono-num mt-1 text-2xl font-bold">{videos.length > 0 ? formatK(Math.round(totalViews / videos.length)) : '0'}</div>
        </div>
        <div className="glass-card p-5">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Avg CTR</div>
          <div className="font-mono-num mt-1 text-2xl font-bold">{avgCtr > 0 ? avgCtr.toFixed(1) + '%' : '--'}</div>
          <div className="text-[11px] text-[var(--text3)] mt-1 font-mono-num">{formatCash(cashPerVideo)} / video</div>
        </div>
      </div>

      {/* Sync */}
      <div className="mb-6 flex items-center gap-3">
        <button onClick={handleSync} disabled={syncing} className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase text-white hover:opacity-90 disabled:opacity-30">
          {syncing ? 'Sincronizando...' : '\u27F3 Sincronizar YouTube'}
        </button>
        {syncStatus && <span className={`text-[12px] ${syncStatus.includes('videos') && !syncStatus.includes('Error') ? 'text-[var(--green)]' : syncStatus.includes('Error') ? 'text-[var(--red)]' : 'text-[var(--text3)]'}`}>{syncStatus}</span>}
      </div>

      {/* Video grid */}
      {videos.length === 0 ? (
        <div className="py-16 text-center text-[13px] text-[var(--text3)]">Sin videos este mes. Sincroniza YouTube para importar.</div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {videos.map(v => (
            <VideoCard key={v.id} video={v} isExpanded={expanded === v.id}
              onToggle={() => setExpanded(expanded === v.id ? null : v.id)}
              onUpdate={updateField} onDelete={deleteVideo} leads={leads}
              analyzingId={analyzingId} analyzeVideo={analyzeVideo}
              showTranscriptFor={showTranscriptFor} setShowTranscriptFor={setShowTranscriptFor}
              transcriptInput={transcriptInput} setTranscriptInput={setTranscriptInput} />
          ))}
        </div>
      )}

      {/* Undo bar */}
      {undoAction && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] glass-card overflow-hidden shadow-lg border border-[var(--border2)] min-w-[320px]">
          <div className="flex items-center gap-4 px-5 py-3.5">
            <span className="text-[13px] text-[var(--text2)]">{undoAction.label}</span>
            <button onClick={handleUndo} className="rounded-lg bg-[var(--accent)] px-4 py-1.5 text-[11px] font-semibold uppercase text-white">Deshacer</button>
            <button onClick={() => { setUndoAction(null); if (undoTimerRef.current) clearTimeout(undoTimerRef.current); if (undoIntervalRef.current) clearInterval(undoIntervalRef.current) }} className="text-[var(--text3)] text-sm">\u00D7</button>
          </div>
          <div className="h-[3px] bg-[var(--bg4)]"><div className="h-full bg-[var(--accent)] transition-[width] duration-[50ms] ease-linear" style={{ width: `${undoProgress}%` }} /></div>
        </div>
      )}
    </div>
  )
}

/* ---------- Video Card ---------- */

function VideoCard({ video: v, isExpanded, onToggle, onUpdate, onDelete, leads, analyzingId, analyzeVideo, showTranscriptFor, setShowTranscriptFor, transcriptInput, setTranscriptInput }: {
  video: Video; isExpanded: boolean; onToggle: () => void
  onUpdate: (id: string, field: string, value: unknown) => void
  onDelete: (id: string) => void; leads: Lead[]
  analyzingId: string | null; analyzeVideo: (v: Video, t?: string) => void
  showTranscriptFor: string | null; setShowTranscriptFor: (id: string | null) => void
  transcriptInput: string; setTranscriptInput: (v: string) => void
}) {
  const cls = v.classification || {}
  const title = v.title || 'Sin titulo'
  const related = leads.filter(l => l.agenda_point && title.length > 3 && l.agenda_point.toLowerCase().includes(title.toLowerCase().substring(0, 25)))
  const cierres = related.filter(l => l.status === 'Cerrado').length

  if (isExpanded) return (
    <div className="glass-card overflow-hidden col-span-3 grid grid-cols-[400px_1fr]">
      {/* Left: thumbnail */}
      <div className="relative">
        {v.metrics?.thumbnail ? (
          <img src={v.metrics.thumbnail} alt="" className="w-full h-full min-h-[350px] object-cover" />
        ) : (
          <div className="w-full h-full min-h-[350px] bg-gradient-to-br from-[var(--bg3)] to-[var(--bg4)] flex items-center justify-center">
            <div className="text-4xl">&#9654;</div>
          </div>
        )}
      </div>

      {/* Right: content */}
      <div className="p-5 space-y-4 overflow-y-auto max-h-[550px]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[14px] font-semibold leading-tight">{title}</div>
            <div className="text-[11px] text-[var(--text3)] mt-0.5">{v.published_at?.split('T')[0]}</div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={(e) => { e.stopPropagation(); onDelete(v.id) }} className="rounded-md bg-[var(--bg4)] px-3 py-1.5 text-[10px] text-[var(--red)] hover:opacity-80">Eliminar</button>
            <button onClick={onToggle} className="rounded-md bg-[var(--bg4)] px-3 py-1.5 text-[10px] text-[var(--text3)] hover:text-[var(--text)]">\u2715 Cerrar</button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-4 gap-3">
          <div className="rounded-lg bg-[var(--bg4)] p-3 text-center">
            <div className="text-[8px] uppercase tracking-wider text-[var(--text3)]">Cash</div>
            <input type="number" value={v.cash || 0} onChange={e => onUpdate(v.id, 'cash', Number(e.target.value) || 0)}
              className="w-full bg-transparent text-center font-mono-num text-[16px] font-bold text-[var(--green)] outline-none" onClick={e => e.stopPropagation()} />
          </div>
          <div className="rounded-lg bg-[var(--bg4)] p-3 text-center">
            <div className="text-[8px] uppercase tracking-wider text-[var(--text3)]">Agendas / Chats</div>
            <input type="number" value={v.chats || 0} onChange={e => onUpdate(v.id, 'chats', Number(e.target.value) || 0)}
              className="w-full bg-transparent text-center font-mono-num text-[16px] font-bold text-[var(--text)] outline-none" onClick={e => e.stopPropagation()} />
          </div>
          <div className="rounded-lg bg-[var(--bg4)] p-3 text-center">
            <div className="text-[8px] uppercase tracking-wider text-[var(--text3)]">CTR</div>
            <div className="font-mono-num text-[16px] font-bold">{Number(v.metrics?.ctr) > 0 ? `${v.metrics.ctr}%` : '--'}</div>
          </div>
          <div className="rounded-lg bg-[var(--bg4)] p-3 text-center">
            <div className="text-[8px] uppercase tracking-wider text-[var(--text3)]">Cierres</div>
            <div className="font-mono-num text-[16px] font-bold">{cierres}</div>
          </div>
        </div>

        {/* Link */}
        {v.url && (
          <a href={v.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md bg-[var(--bg4)] px-3 py-1.5 text-[11px] text-[var(--text2)] hover:text-[var(--text)] transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            Ver en YouTube
          </a>
        )}

        {/* Description */}
        {cls.description && (
          <div>
            <div className="text-[9px] font-medium uppercase tracking-wider text-[var(--text3)] mb-1">Descripcion</div>
            <div className="text-[11px] text-[var(--text2)] bg-[var(--bg3)] rounded-lg p-3 border border-[var(--border)] whitespace-pre-wrap max-h-[120px] overflow-y-auto">{cls.description}</div>
          </div>
        )}

        {/* Summary */}
        {cls.summary && (
          <div>
            <div className="text-[9px] font-medium uppercase tracking-wider text-[var(--text3)] mb-1">Resumen</div>
            <div className="text-[12px] text-[var(--text2)] leading-relaxed bg-[var(--bg3)] rounded-lg p-3 border border-[var(--border)] whitespace-pre-wrap">{cls.summary}</div>
          </div>
        )}

        {/* Performance chart */}
        {(v.metrics?.performanceHistory?.length || 0) > 1 && (
          <div>
            <div className="text-[9px] font-medium uppercase tracking-wider text-[var(--text3)] mb-2">Rendimiento</div>
            <PerfChart data={v.metrics.performanceHistory || []} />
          </div>
        )}

        {/* Related leads */}
        {related.length > 0 && (
          <div>
            <div className="text-[9px] font-medium uppercase tracking-wider text-[var(--text3)] mb-2">Leads relacionados</div>
            <div className="space-y-1">
              {related.slice(0, 6).map((l, i) => (
                <div key={i} className="flex items-center justify-between rounded-md bg-[var(--bg4)] px-3 py-2 text-[11px]">
                  <span className="text-[var(--text2)]">{l.client_name || 'Anonimo'}</span>
                  <div className="flex items-center gap-2">
                    {l.program_purchased && <span className="text-[var(--text3)]">{l.program_purchased}</span>}
                    <span className={l.status === 'Cerrado' ? 'text-[var(--green)] font-semibold' : 'text-[var(--text3)]'}>{l.status}</span>
                    {Number(l.payment) > 0 && <span className="font-mono-num text-[var(--green)]">{formatCash(Number(l.payment))}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AI Analysis */}
        {!cls.summary && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <button onClick={() => analyzeVideo(v)} disabled={analyzingId === v.id}
                className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase text-white hover:opacity-90 disabled:opacity-30">
                {analyzingId === v.id ? 'Analizando...' : '\u2726 Analizar con IA'}
              </button>
              <button onClick={() => setShowTranscriptFor(showTranscriptFor === v.id ? null : v.id)}
                className="rounded-lg border border-[var(--border2)] px-4 py-2.5 text-[11px] font-semibold uppercase text-[var(--text3)] hover:border-[var(--accent)]">
                {showTranscriptFor === v.id ? 'Cerrar' : '+ Pegar transcript'}
              </button>
            </div>
            {showTranscriptFor === v.id && (
              <div className="space-y-2">
                <textarea value={transcriptInput} onChange={e => setTranscriptInput(e.target.value)} rows={3} placeholder="Pega el transcript del video..."
                  className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none resize-y" onClick={e => e.stopPropagation()} />
                <button onClick={() => analyzeVideo(v, transcriptInput)} disabled={analyzingId === v.id || !transcriptInput.trim()}
                  className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase text-white hover:opacity-90 disabled:opacity-30">
                  {analyzingId === v.id ? 'Analizando...' : '\u2726 Analizar con transcript'}
                </button>
              </div>
            )}
          </div>
        )}
        {cls.summary && (
          <button onClick={() => analyzeVideo(v)} disabled={analyzingId === v.id}
            className="rounded-lg border border-[var(--border2)] px-4 py-2 text-[10px] font-semibold uppercase text-[var(--text3)] hover:border-[var(--accent)] hover:text-[var(--accent)]">
            {analyzingId === v.id ? 'Analizando...' : '\u27F3 Re-analizar con IA'}
          </button>
        )}
      </div>
    </div>
  )

  // Collapsed card
  return (
    <div className="glass-card overflow-hidden cursor-pointer" onClick={onToggle}>
      <div className="relative" style={{ aspectRatio: '16/9' }}>
        {v.metrics?.thumbnail ? (
          <img src={v.metrics.thumbnail} alt="" className="w-full h-full object-cover rounded-t-lg" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[var(--bg3)] to-[var(--bg4)] flex items-center justify-center rounded-t-lg">
            <div className="text-3xl">&#9654;</div>
          </div>
        )}
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-3">
          <div className="font-mono-num text-lg font-bold text-[var(--green)]">{formatCash(v.cash)}</div>
        </div>
        {v.url && (
          <a href={v.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
            className="absolute top-2 right-2 rounded-md bg-black/50 p-1.5 text-white/70 hover:text-white transition-colors backdrop-blur-sm">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </a>
        )}
      </div>
      <div className="p-3">
        <div className="text-[12px] font-medium truncate">{title}</div>
        <div className="text-[11px] text-[var(--text3)] mt-0.5">{v.chats} agendas</div>
      </div>
    </div>
  )
}

/* ---------- Performance Chart ---------- */

function PerfChart({ data }: { data: PerfSnapshot[] }) {
  if (data.length < 2) return null
  const maxV = Math.max(...data.map(d => d.views), 1)
  const w = 500, h = 100, pL = 40, pR = 5, pT = 5, pB = 18
  const cW = w - pL - pR, cH = h - pT - pB
  const pts = data.map((d, i) => ({ x: pL + (i / (data.length - 1)) * cW, y: pT + cH - (d.views / maxV) * cH, ...d }))
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const area = line + ` L${pts[pts.length - 1].x},${pT + cH} L${pts[0].x},${pT + cH} Z`
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: 120 }}>
      <defs><linearGradient id="vg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" /><stop offset="100%" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
      {[0, 0.5, 1].map(p => { const y = pT + cH - p * cH; return <g key={p}><line x1={pL} y1={y} x2={w - pR} y2={y} stroke="var(--border)" strokeWidth="0.5" /><text x={pL - 3} y={y + 3} fill="var(--text3)" fontSize="7" textAnchor="end">{formatK(Math.round(maxV * p))}</text></g> })}
      <path d={area} fill="url(#vg)" /><path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
      {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="2" fill="var(--accent)" />)}
      {[0, pts.length - 1].map(i => <text key={i} x={pts[i].x} y={pT + cH + 12} fill="var(--text3)" fontSize="7" textAnchor="middle">{pts[i].date.split('T')[0].slice(5)}</text>)}
    </svg>
  )
}
