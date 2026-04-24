'use client'

import { useState, useEffect, useCallback } from 'react'
import { useToast } from '@/shared/components/toast'
import { useSupabase } from '@/shared/hooks/use-supabase'
import { formatCash } from '@/shared/lib/supabase/queries'

type Reel = {
  id: string; title: string | null; content_type: string
  metrics: Record<string, number | string>
  classification: { dolor?: string; angulos?: string[]; cta?: string; transcript?: string } | null
  cash: number; chats: number; published_at: string | null; url: string | null; notes: string | null; external_id: string | null
}

type Lead = { client_name: string | null; status: string | null; payment: number | null; program_purchased: string | null; agenda_point: string | null }

export default function ReelsPage() {
  const { toast } = useToast()
  const { supabase, ready, userId } = useSupabase()
  const [reels, setReels] = useState<Reel[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [masterLists, setMasterLists] = useState<{ ctas: string[] }>({ ctas: [] })
  const [ytVideos, setYtVideos] = useState<{ id: string; title: string }[]>([])
  const [selectedMonth, setSelectedMonth] = useState<string>('all')
  const [availableMonths, setAvailableMonths] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  /** Suma cash/chats de todo el filtro (mes); el backend la calcula sobre todos los reels, no solo la página. */
  const [aggregateTotals, setAggregateTotals] = useState({ total_cash: 0, total_chats: 0 })
  const PAGE_SIZE = 10
  const apiBase =
    (process.env.NEXT_PUBLIC_BACKEND_URL || '').trim().replace(/\/$/, '') || '/api-backend'
  const directBackendBase =
    (process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000').trim().replace(/\/$/, '')

  const fetchData = useCallback(async () => {
    if (!ready) return
    if (!userId) return
    setLoading(true)
    try {
      const monthParam = selectedMonth === 'all' ? '' : `&month=${encodeURIComponent(selectedMonth)}`
      const res = await fetch(`${apiBase}/reels?page=${page}&page_size=${PAGE_SIZE}${monthParam}`, {
        headers: { 'X-User-Id': userId },
      })
      const rawText = await res.text()
      const raw = (() => {
        try { return rawText ? JSON.parse(rawText) : {} } catch { return { detail: rawText } }
      })()
      if (!res.ok) {
        const detail = typeof raw === 'object' && raw && 'detail' in raw
          ? String((raw as { detail: unknown }).detail)
          : res.statusText
        toast(`Error al cargar reels: ${detail}`)
        return
      }
      const reelsData = Array.isArray((raw as { reels?: unknown[] }).reels)
        ? ((raw as { reels: Reel[] }).reels)
        : []
      setReels(reelsData)
      setTotal(Number((raw as { total?: number }).total || 0))
      setTotalPages(Number((raw as { total_pages?: number }).total_pages || 0))
      setAggregateTotals({
        total_cash: Number((raw as { total_cash?: unknown }).total_cash) || 0,
        total_chats: Number((raw as { total_chats?: unknown }).total_chats) || 0,
      })
      const monthsRaw = (raw as { available_months?: unknown[] }).available_months
      setAvailableMonths(Array.isArray(monthsRaw) ? monthsRaw.map(m => String(m)) : [])
      setLeads([])
      setYtVideos([])
      setMasterLists({ ctas: [] })
    } finally {
      setLoading(false)
    }
  }, [selectedMonth, page, ready, userId, apiBase, toast])

  useEffect(() => { fetchData() }, [fetchData])

  // Auto-fix thumbnails
  useEffect(() => {
    if (!ready) return
    fetch('/api/fix-thumbnails', { method: 'POST' }).then(r => r.json()).then(d => { if (d.fixed > 0) fetchData() }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  // ── Sync ──
  const handleSync = async () => {
    if (!userId) { toast('Error: no hay sesión activa'); return }
    if (!confirm('Sincronizar reels desde Apify ahora?')) return
    setSyncing(true); setSyncStatus('Sincronizando...')
    try {
      // El sync puede tardar bastante; evitamos el rewrite de Next para no cortar por proxy.
      const res = await fetch(`${directBackendBase}/reels/sync-apify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({}),
      })
      const rawText = await res.text()
      const data = (() => {
        try { return rawText ? JSON.parse(rawText) : {} } catch { return { detail: rawText } }
      })()
      if (!res.ok || data.error) {
        setSyncStatus(`Error: ${data.error || data.detail || 'No se pudo sincronizar'}`)
      }
      else {
        setSyncStatus(`✓ ${data.total} reels (${data.new} nuevos). Clasificando con IA...`)
        await fetchData()
        await autoClassify()
        setSyncStatus(prev => prev.replace('Clasificando con IA...', 'Listo ✓'))
        toast('Sync + clasificacion completada ✓')
      }
    } catch (e) { setSyncStatus(`Error: ${(e as Error).message}`) }
    setSyncing(false)
  }

  // ── Auto-classify unclassified reels ──
  const autoClassify = async () => {
    const { data: items } = await supabase.from('content_items').select('id, classification, notes').eq('content_type', 'reel').eq('platform', 'instagram')
    const toClassify = (items || []).filter((r: Record<string, unknown>) => !(r.classification as Record<string, unknown> | null)?.dolor)
    for (const r of toClassify) {
      const transcript = (r.classification as Record<string, unknown>)?.transcript as string || String(r.notes || '')
      if (transcript.length < 10) continue
      try { await fetch('/api/classify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentId: r.id, transcript, type: 'reel' }) }) } catch { /* skip */ }
    }
    fetchData()
  }

  // ── Inline update ──
  const updateField = async (id: string, field: string, value: unknown) => {
    if (field === 'cta') {
      const reel = reels.find(r => r.id === id)
      const cls = { ...(reel?.classification || {}), cta: value as string }
      await supabase.from('content_items').update({ classification: cls, updated_at: new Date().toISOString() }).eq('id', id)
      setReels(prev => prev.map(r => {
        if (r.id !== id) return r
        return { ...r, classification: { ...r.classification, cta: value as string } }
      }))
      return
    }
    if (field === 'cash' || field === 'chats') {
      if (!userId) return
      const prev = reels.find(r => r.id === id)
      if (!prev) return
      const body = field === 'cash'
        ? { cash: Number(value) || 0 }
        : { chats: Math.trunc(Number(value)) || 0 }
      try {
        const res = await fetch(`${apiBase}/reels/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
          body: JSON.stringify(body),
        })
        const rawText = await res.text()
        const data = (() => {
          try { return rawText ? JSON.parse(rawText) : {} } catch { return { detail: rawText } }
        })()
        if (!res.ok) {
          const detail = typeof data === 'object' && data && 'detail' in data
            ? String((data as { detail: unknown }).detail)
            : res.statusText
          toast(`No se guardó el reel: ${detail}`)
          return
        }
        const newCash = field === 'cash' ? (body as { cash: number }).cash : (Number(prev.cash) || 0)
        const newChats = field === 'chats' ? (body as { chats: number }).chats : (Number(prev.chats) || 0)
        setAggregateTotals(a => ({
          total_cash: a.total_cash - (Number(prev.cash) || 0) + newCash,
          total_chats: a.total_chats - (Number(prev.chats) || 0) + newChats,
        }))
        setReels(p => p.map(r => (r.id !== id ? r : { ...r, ...body })))
      } catch (e) {
        toast(`No se guardó el reel: ${(e as Error).message}`)
      }
      return
    }
  }

  const addCta = async (value: string) => {
    if (!value.trim() || !userId) return
    const updated = [...masterLists.ctas, value.trim()]
    await supabase.from('master_lists').upsert({ user_id: userId, category: 'ctas', items: updated, updated_at: new Date().toISOString() }, { onConflict: 'user_id,category' })
    setMasterLists(prev => ({ ...prev, ctas: updated }))
  }

  const totalChats = aggregateTotals.total_chats
  const totalCash = aggregateTotals.total_cash

  if (!ready || loading) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Reels <span className="text-[var(--text3)] text-sm font-normal">{selectedMonth === 'all' ? 'Todos los meses' : selectedMonth}</span></h2>
        <select
          value={selectedMonth}
          onChange={(e) => { setSelectedMonth(e.target.value); setPage(1) }}
          className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[12px] text-[var(--text)] outline-none"
        >
          <option value="all">Todos los meses</option>
          {availableMonths.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-4 gap-4">
        <div className="glass-card p-5">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Chats del mes</div>
          <div className="font-mono-num mt-1 text-3xl font-bold">{totalChats}</div>
        </div>
        <div className="glass-card p-5">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Piezas publicadas</div>
          <div className="font-mono-num mt-1 text-3xl font-bold">{total}</div>
        </div>
        <div className="glass-card p-5">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Cash generado</div>
          <div className="font-mono-num mt-1 text-3xl font-bold text-[var(--green)]">{formatCash(totalCash)}</div>
        </div>
        <div className="glass-card p-5">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">CPC promedio</div>
          <div className="font-mono-num mt-1 text-3xl font-bold">{totalChats > 0 ? formatCash(totalCash / totalChats) : '$0'}</div>
        </div>
      </div>

      {/* Sync button */}
      <div className="mb-6 flex items-center gap-3">
        <button onClick={handleSync} disabled={syncing} className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase text-white hover:opacity-90 disabled:opacity-30">
          {syncing ? 'Sincronizando...' : '⟳ Sincronizar Instagram'}
        </button>
        {syncStatus && <span className={`text-[12px] ${syncStatus.includes('✓') ? 'text-[var(--green)]' : syncStatus.includes('Error') ? 'text-[var(--red)]' : 'text-[var(--text3)]'}`}>{syncStatus}</span>}
      </div>

      {/* Card grid */}
      {reels.length === 0 ? (
        <div className="py-16 text-center text-[13px] text-[var(--text3)]">Sin reels para este filtro. Sincroniza Instagram para empezar.</div>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          {reels.map(reel => (
            <ReelCard key={reel.id} reel={reel} isExpanded={expanded === reel.id}
              onToggle={() => setExpanded(expanded === reel.id ? null : reel.id)}
              onUpdate={updateField} leads={leads} masterLists={masterLists}
              ytVideos={ytVideos} onAddCta={addCta} />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-lg border border-[var(--border2)] px-3 py-1.5 text-[12px] disabled:opacity-40"
          >
            Anterior
          </button>
          <span className="text-[12px] text-[var(--text3)]">Página {page} de {totalPages}</span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="rounded-lg border border-[var(--border2)] px-3 py-1.5 text-[12px] disabled:opacity-40"
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  )
}

/* ---------- Reel Card ---------- */

function ReelCard({ reel, isExpanded, onToggle, onUpdate, leads, masterLists, ytVideos, onAddCta }: {
  reel: Reel; isExpanded: boolean; onToggle: () => void
  onUpdate: (id: string, field: string, value: unknown) => void
  leads: Lead[]; masterLists: { ctas: string[] }
  ytVideos: { id: string; title: string }[]; onAddCta: (v: string) => void
}) {
  const [imgErr, setImgErr] = useState(false)
  const rawThumb = String(reel.metrics?.thumbnail || '')
  useEffect(() => {
    setImgErr(false)
  }, [rawThumb])
  const thumb =
    rawThumb && !imgErr
      ? `/api/proxy-image?url=${encodeURIComponent(rawThumb)}`
      : ''
  const views = Number(reel.metrics?.views) || 0
  const likes = Number(reel.metrics?.likes) || 0
  const saves = Number(reel.metrics?.saves) || 0
  const cls = reel.classification || {}
  const cpc = reel.chats > 0 ? reel.cash / reel.chats : 0
  const title = reel.title || reel.notes?.substring(0, 60) || 'Sin titulo'
  const related = leads.filter(l => l.agenda_point && title.length > 3 && l.agenda_point.toLowerCase().includes(title.toLowerCase().substring(0, 20)))

  return (
    <div className={`glass-card overflow-hidden transition-all ${isExpanded ? 'col-span-4 grid grid-cols-[300px_1fr]' : 'cursor-pointer'}`} onClick={!isExpanded ? onToggle : undefined}>
      {/* Thumbnail */}
      <div className="relative">
        {thumb ? (
          <img
            src={thumb}
            alt=""
            className={`w-full object-cover ${isExpanded ? 'h-full min-h-[300px]' : 'h-44'}`}
            onError={() => setImgErr(true)}
          />
        ) : (
          <div className={`w-full bg-gradient-to-br from-[var(--bg3)] to-[var(--bg4)] flex flex-col items-center justify-center ${isExpanded ? 'h-full min-h-[300px]' : 'h-44'}`}>
            <div className="text-3xl mb-1">🎥</div>
            <div className="text-[10px] text-[var(--text3)] px-3 text-center truncate max-w-full">{title}</div>
          </div>
        )}
        {!isExpanded && (
          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-3">
            <div className="font-mono-num text-lg font-bold text-[var(--green)]">{formatCash(reel.cash)}</div>
          </div>
        )}
        {reel.url && !isExpanded && (
          <a href={reel.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
            className="absolute top-2 right-2 rounded-md bg-black/50 p-1.5 text-white/70 hover:text-white transition-colors backdrop-blur-sm">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </a>
        )}
      </div>

      {/* Collapsed info */}
      {!isExpanded && (
        <div className="p-3">
          <div className="text-[12px] font-medium truncate">{title}</div>
          <div className="text-[11px] text-[var(--text3)] mt-0.5">{reel.chats} chats · CPC {formatCash(cpc)}</div>
          {cls.dolor && (
            <div className="mt-2 flex flex-wrap gap-1">
              <span className="rounded-md border border-red-500/20 bg-red-500/15 px-1.5 py-0.5 text-[9px] font-medium text-red-400">{cls.dolor}</span>
            </div>
          )}
        </div>
      )}

      {/* Expanded detail */}
      {isExpanded && (
        <div className="p-5 space-y-4 overflow-y-auto max-h-[500px]">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[14px] font-semibold">{title}</div>
              <div className="text-[11px] text-[var(--text3)] mt-0.5">{reel.published_at?.split('T')[0]}</div>
            </div>
            <div className="flex items-center gap-2">
              {reel.url && (
                <a href={reel.url} target="_blank" rel="noopener noreferrer"
                  className="rounded-md bg-[var(--bg4)] px-3 py-1.5 text-[10px] text-[var(--text2)] hover:text-[var(--text)] transition-colors">
                  Ver en Instagram →
                </a>
              )}
              <button onClick={onToggle} className="rounded-md bg-[var(--bg4)] px-3 py-1.5 text-[10px] text-[var(--text3)] hover:text-[var(--text)]">✕ Cerrar</button>
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-4 gap-3">
            <div className="rounded-lg bg-[var(--bg4)] p-3 text-center">
              <div className="text-[8px] uppercase tracking-wider text-[var(--text3)]">Cash</div>
              <input type="number" value={reel.cash || 0} onChange={e => onUpdate(reel.id, 'cash', Number(e.target.value) || 0)}
                className="w-full bg-transparent text-center font-mono-num text-[16px] font-bold text-[var(--green)] outline-none" />
            </div>
            <div className="rounded-lg bg-[var(--bg4)] p-3 text-center">
              <div className="text-[8px] uppercase tracking-wider text-[var(--text3)]">Chats</div>
              <input type="number" value={reel.chats || 0} onChange={e => onUpdate(reel.id, 'chats', Number(e.target.value) || 0)}
                className="w-full bg-transparent text-center font-mono-num text-[16px] font-bold text-[var(--text)] outline-none" />
            </div>
            <div className="rounded-lg bg-[var(--bg4)] p-3 text-center">
              <div className="text-[8px] uppercase tracking-wider text-[var(--text3)]">CPC</div>
              <div className="font-mono-num text-[16px] font-bold">{formatCash(cpc)}</div>
            </div>
            <div className="rounded-lg bg-[var(--bg4)] p-3 text-center">
              <div className="text-[8px] uppercase tracking-wider text-[var(--text3)]">Views</div>
              <div className="font-mono-num text-[16px] font-bold">{fmtK(views)}</div>
            </div>
          </div>

          {/* Metrics row */}
          {(likes > 0 || saves > 0) && (
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-[var(--bg4)] p-2.5 text-center">
                <div className="text-[8px] uppercase tracking-wider text-[var(--text3)]">Likes</div>
                <div className="font-mono-num text-[14px] font-bold">{fmtK(likes)}</div>
              </div>
              <div className="rounded-lg bg-[var(--bg4)] p-2.5 text-center">
                <div className="text-[8px] uppercase tracking-wider text-[var(--text3)]">Guardados</div>
                <div className="font-mono-num text-[14px] font-bold">{fmtK(saves)}</div>
              </div>
              <div className="rounded-lg bg-[var(--bg4)] p-2.5 text-center">
                <div className="text-[8px] uppercase tracking-wider text-[var(--text3)]">Comentarios</div>
                <div className="font-mono-num text-[14px] font-bold">{fmtK(Number(reel.metrics?.comments) || 0)}</div>
              </div>
            </div>
          )}

          {/* Classification tags */}
          <div>
            <div className="text-[9px] font-medium uppercase tracking-wider text-[var(--text3)] mb-2">Clasificacion (IA)</div>
            <div className="flex flex-wrap gap-1.5">
              {cls.dolor ? <span className="rounded-md border border-red-500/20 bg-red-500/15 px-2.5 py-1 text-[10px] font-medium text-red-400">{cls.dolor}</span> : <span className="text-[10px] text-[var(--text3)] italic">Sin dolor detectado</span>}
              {(cls.angulos || []).map(a => <span key={a} className="rounded-md border border-amber-500/20 bg-amber-500/15 px-2.5 py-1 text-[10px] font-medium text-amber-400">{a}</span>)}
            </div>
          </div>

          {/* CTA — manual select */}
          <div>
            <div className="text-[9px] font-medium uppercase tracking-wider text-[var(--text3)] mb-2">CTA (manual)</div>
            <select value={cls.cta || ''} onClick={e => e.stopPropagation()} onChange={async e => {
              if (e.target.value === '__new__') { const v = prompt('Nuevo CTA:'); if (v) { await onAddCta(v); onUpdate(reel.id, 'cta', v.trim()) } }
              else onUpdate(reel.id, 'cta', e.target.value)
            }} className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[12px] text-[var(--text)] outline-none cursor-pointer">
              <option value="">Sin CTA</option>
              {ytVideos.length > 0 && <optgroup label="Videos de YouTube">
                {ytVideos.map(v => <option key={v.id} value={`YT: ${v.title}`}>▶ {v.title}</option>)}
              </optgroup>}
              {masterLists.ctas.length > 0 && <optgroup label="CTAs">
                {masterLists.ctas.map(c => <option key={c} value={c}>{c}</option>)}
              </optgroup>}
              <option value="__new__">+ Crear nuevo CTA...</option>
            </select>
          </div>

          {/* Related leads */}
          {related.length > 0 && (
            <div>
              <div className="text-[9px] font-medium uppercase tracking-wider text-[var(--text3)] mb-2">Leads de este reel</div>
              <div className="space-y-1">
                {related.slice(0, 5).map((l, i) => (
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
        </div>
      )}
    </div>
  )
}

function fmtK(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return Math.round(n / 1000) + 'K'
  return String(n)
}
