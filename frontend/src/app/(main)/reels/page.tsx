'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { apiFetch } from '@/lib/api'
import { useToast } from '@/shared/components/toast'
import { useSupabase } from '@/shared/hooks/use-supabase'

type Reel = {
  id: string
  title: string | null
  content_type: string
  metrics: Record<string, number | string>
  classification: { dolor?: string; angulos?: string[]; cta?: string; transcript?: string } | null
  cash: number
  chats: number
  published_at: string | null
  url: string | null
  notes: string | null
  external_id: string | null
}

type ReelsListResponse = {
  reels: Reel[]
  total: number
  page: number
  page_size: number
  total_pages: number
  available_months: string[]
  total_cash: number
  total_chats: number
}

type ReelsMetrics = {
  chats_del_mes: number
  piezas_publicadas: number
  sin_clasificar: number
}

type SyncStatus = {
  total: number
  processed: number
  status: 'idle' | 'running' | 'done' | 'error'
  phase?: 'idle' | 'collecting' | 'processing' | 'done' | 'error'
  discovered?: number
}

export default function ReelsPage() {
  const { toast } = useToast()
  const { ready, userId } = useSupabase()
  const [reels, setReels] = useState<Reel[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [monthMode, setMonthMode] = useState<'all' | 'current' | 'comparison'>('all')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [aggregateTotals, setAggregateTotals] = useState({ total_cash: 0, total_chats: 0 })
  const [metrics, setMetrics] = useState<ReelsMetrics>({
    chats_del_mes: 0,
    piezas_publicadas: 0,
    sin_clasificar: 0,
  })
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ total: 0, processed: 0, status: 'idle' })
  const previousSyncStatus = useRef<SyncStatus['status']>('idle')
  const [masterLists, setMasterLists] = useState<{ dolores: string[]; angulos: string[]; ctas: string[] }>({
    dolores: [],
    angulos: [],
    ctas: [],
  })
  const isSyncRunning = syncing || syncStatus.status === 'running'
  const syncProgressPct = useMemo(() => {
    if (!isSyncRunning || syncStatus.total <= 0) return 0
    return Math.min(100, Math.max(0, Math.round((syncStatus.processed / syncStatus.total) * 100)))
  }, [isSyncRunning, syncStatus.total, syncStatus.processed])
  const PAGE_SIZE = 12
  const authHeaders = () => {
    const token = typeof window !== 'undefined' ? sessionStorage.getItem('evoluciona_token') : null
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    if (userId) headers['X-User-Id'] = userId
    return headers
  }

  const selectedMonth = useMemo(() => {
    const now = new Date()
    const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    if (monthMode === 'all') return null
    if (monthMode === 'current') return current
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`
  }, [monthMode])

  const parseJson = async <T,>(res: Response): Promise<T> => {
    const text = await res.text()
    let data: unknown = {}
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      throw new Error(text || `HTTP ${res.status}`)
    }
    if (!res.ok) {
      const maybeDetail =
        typeof data === 'object' && data !== null && 'detail' in data ? String((data as { detail: unknown }).detail) : `HTTP ${res.status}`
      throw new Error(maybeDetail)
    }
    return data as T
  }

  const fetchData = useCallback(async () => {
    if (!ready) return
    setLoading(true)
    try {
      const monthParam = selectedMonth ? `&month=${encodeURIComponent(selectedMonth)}` : ''
      const res = await apiFetch(`/reels?page=${page}&page_size=${PAGE_SIZE}${monthParam}`, {
        headers: authHeaders(),
      })
      const data = await parseJson<ReelsListResponse>(res)
      setReels(Array.isArray(data.reels) ? data.reels : [])
      setTotalPages(Number(data.total_pages || 0))
      setAggregateTotals({
        total_cash: Number(data.total_cash || 0),
        total_chats: Number(data.total_chats || 0),
      })
    } catch (e) {
      toast(`Error al cargar reels: ${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [page, selectedMonth, ready, userId, toast])

  const fetchMetrics = useCallback(async () => {
    if (!ready) return
    try {
      const monthParam = selectedMonth ? `?month=${encodeURIComponent(selectedMonth)}` : ''
      const res = await apiFetch(`/reels/metrics${monthParam}`, {
        headers: authHeaders(),
      })
      const data = await parseJson<ReelsMetrics>(res)
      setMetrics(data)
    } catch (e) {
      toast(`Error al cargar métricas de reels: ${(e as Error).message}`)
    }
  }, [selectedMonth, ready, userId, toast])

  const fetchSyncStatus = useCallback(async () => {
    if (!ready) return
    try {
      const res = await apiFetch('/reels/sync-status', { headers: authHeaders() })
      const data = await parseJson<SyncStatus>(res)
      setSyncStatus({
        total: Number(data.total || 0),
        processed: Number(data.processed || 0),
        status: ['idle', 'running', 'done', 'error'].includes(String(data.status)) ? data.status : 'idle',
        phase: ['idle', 'collecting', 'processing', 'done', 'error'].includes(String(data.phase)) ? data.phase : 'idle',
        discovered: Number(data.discovered || 0),
      })
    } catch {
      setSyncStatus({ total: 0, processed: 0, status: 'idle', phase: 'idle', discovered: 0 })
    }
  }, [ready, userId])

  const fetchMasterLists = useCallback(async () => {
    if (!ready || !userId) return
    try {
      const res = await apiFetch('/master-lists', { headers: authHeaders() })
      const data = await parseJson<{ dolores: string[]; angulos: string[]; ctas: string[] }>(res)
      setMasterLists({
        dolores: Array.isArray(data.dolores) ? data.dolores : [],
        angulos: Array.isArray(data.angulos) ? data.angulos : [],
        ctas: Array.isArray(data.ctas) ? data.ctas : [],
      })
    } catch {
      setMasterLists({ dolores: [], angulos: [], ctas: [] })
    }
  }, [ready, userId])

  useEffect(() => {
    fetchData()
    fetchMetrics()
  }, [fetchData, fetchMetrics])

  useEffect(() => {
    fetchSyncStatus()
    fetchMasterLists()
  }, [fetchSyncStatus, fetchMasterLists])

  useEffect(() => {
    const refreshLists = () => { fetchMasterLists() }
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchMasterLists()
    }
    window.addEventListener('master-lists-updated', refreshLists)
    window.addEventListener('focus', refreshLists)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('master-lists-updated', refreshLists)
      window.removeEventListener('focus', refreshLists)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [fetchMasterLists])

  useEffect(() => {
    if (syncStatus.status !== 'running') return
    const id = window.setInterval(() => {
      fetchSyncStatus()
    }, 2000)
    return () => window.clearInterval(id)
  }, [syncStatus.status, fetchSyncStatus])

  useEffect(() => {
    const previous = previousSyncStatus.current
    const current = syncStatus.status
    if (previous === 'running' && current !== 'running') {
      fetchData()
      fetchMetrics()
      if (current === 'done') setSyncMessage('Sync completado')
      if (current === 'error') setSyncMessage('Error durante la sincronizacion')
      setSyncing(false)
    }
    previousSyncStatus.current = current
  }, [syncStatus.status, fetchData, fetchMetrics])

  const handleSync = async () => {
    if (!ready || syncStatus.status === 'running') return
    setSyncing(true)
    setSyncMessage('Sincronizando...')
    setSyncStatus((prev) => ({ ...prev, status: 'running', processed: 0 }))
    fetchSyncStatus()
    try {
      const res = await apiFetch('/reels/sync', { method: 'POST', headers: authHeaders() })
      await parseJson<{ status: string }>(res)
      await fetchSyncStatus()
    } catch (e) {
      setSyncMessage(`Error: ${(e as Error).message}`)
      setSyncing(false)
    } finally {
      await fetchSyncStatus()
    }
  }

  const updateField = async (id: string, field: 'cash' | 'chats', value: number) => {
    if (!ready) return
    const prev = reels.find((r) => r.id === id)
    if (!prev) return
    const body = field === 'cash' ? { cash: Number(value) || 0 } : { chats: Math.trunc(Number(value)) || 0 }
    try {
      const res = await apiFetch(`/reels/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      })
      await parseJson<Reel>(res)
      const newCash = field === 'cash' ? body.cash : Number(prev.cash) || 0
      const newChats = field === 'chats' ? body.chats : Number(prev.chats) || 0
      setAggregateTotals((a) => ({
        total_cash: a.total_cash - (Number(prev.cash) || 0) + newCash,
        total_chats: a.total_chats - (Number(prev.chats) || 0) + newChats,
      }))
      setReels((rows) => rows.map((r) => (r.id === id ? { ...r, ...body } : r)))
    } catch (e) {
      toast(`No se guardó el reel: ${(e as Error).message}`)
    }
  }

  if (!ready || loading) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">
          Reels <span className="text-[var(--text3)] text-sm font-normal">{selectedMonth || 'Todos los meses'}</span>
        </h2>
        <div className="inline-flex gap-2 rounded-xl border border-[var(--border2)] bg-[var(--bg2)] p-1">
          <button
            onClick={() => {
              setMonthMode('all')
              setPage(1)
            }}
            className={`rounded-lg px-4 py-2 text-[11px] font-semibold uppercase ${monthMode === 'all' ? 'bg-[var(--accent)] text-white' : 'border border-[var(--border2)] text-[var(--text3)]'}`}
          >
            TODOS
          </button>
          <button
            onClick={() => {
              setMonthMode('current')
              setPage(1)
            }}
            className={`rounded-lg px-4 py-2 text-[11px] font-semibold uppercase ${monthMode === 'current' ? 'bg-[var(--accent)] text-white' : 'border border-[var(--border2)] text-[var(--text3)]'}`}
          >
            MES ACTUAL
          </button>
          <button
            onClick={() => {
              setMonthMode('comparison')
              setPage(1)
            }}
            className={`rounded-lg px-4 py-2 text-[11px] font-semibold uppercase ${monthMode === 'comparison' ? 'bg-[var(--accent)] text-white' : 'border border-[var(--border2)] text-[var(--text3)]'}`}
          >
            MES DE COMPARACION
          </button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-4 gap-4">
        <div className="glass-card p-5">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Chats del mes</div>
          <div className="font-mono-num mt-1 text-3xl font-bold">{metrics.chats_del_mes}</div>
        </div>
        <div className="glass-card p-5">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Piezas publicadas</div>
          <div className="font-mono-num mt-1 text-3xl font-bold">{metrics.piezas_publicadas}</div>
        </div>
        <div className="glass-card p-5">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Cash generado</div>
          <div className="font-mono-num mt-1 text-3xl font-bold text-[var(--green)]">{formatCash(aggregateTotals.total_cash)}</div>
        </div>
        <div className="glass-card p-5">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Sin clasificar</div>
          <div className="font-mono-num mt-1 text-3xl font-bold">{metrics.sin_clasificar}</div>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <button onClick={handleSync} disabled={isSyncRunning} className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase text-white hover:opacity-90 disabled:opacity-30">
          ACTUALIZAR DATOS
        </button>
      </div>
      {syncStatus.status === 'running' && (
        <div className="mb-4 glass-card p-4">
          <div className="mb-2 flex items-center gap-2 text-[12px] text-[var(--text)]">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
            {syncStatus.phase === 'collecting' ? 'Buscando reels en Instagram...' : 'Recolectando metricas de Instagram...'}
          </div>
          <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-[var(--bg4)]">
            <div
              className={`h-full rounded-full bg-[var(--accent)] transition-all duration-500 ease-out ${syncStatus.phase === 'collecting' ? 'animate-pulse' : ''}`}
              style={{ width: `${syncStatus.phase === 'collecting' ? 100 : syncProgressPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[12px] text-[var(--text3)]">
            <span>
              {syncStatus.phase === 'collecting'
                ? `Descubiertos: ${syncStatus.discovered || 0} reels`
                : `Sincronizando: ${syncStatus.processed} de ${syncStatus.total || '?'} reels`}
            </span>
            <span>{syncStatus.phase === 'collecting' ? '...' : `${syncProgressPct}%`}</span>
          </div>
        </div>
      )}
      {syncMessage && <div className={`mb-4 text-[12px] ${syncMessage.startsWith('Error') ? 'text-[var(--red)]' : 'text-[var(--text3)]'}`}>{syncMessage}</div>}

      {reels.length === 0 ? (
        <div className="py-16 text-center text-[13px] text-[var(--text3)]">Sin reels para este filtro. Sincroniza Instagram para empezar.</div>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          {reels.map((reel) => (
            <ReelCard
              key={reel.id}
              reel={reel}
              masterLists={masterLists}
              isExpanded={expanded === reel.id}
              onToggle={() => setExpanded(expanded === reel.id ? null : reel.id)}
              onUpdate={updateField}
            />
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

function ReelCard({
  reel,
  masterLists,
  isExpanded,
  onToggle,
  onUpdate,
}: {
  reel: Reel
  masterLists: { dolores: string[]; angulos: string[]; ctas: string[] }
  isExpanded: boolean
  onToggle: () => void
  onUpdate: (id: string, field: 'cash' | 'chats', value: number) => void
}) {
  const [imgErr, setImgErr] = useState(false)
  const [dolor, setDolor] = useState(reel.classification?.dolor || '')
  const [angulos, setAngulos] = useState((reel.classification?.angulos || []).join(', '))
  const [cta, setCta] = useState(reel.classification?.cta || '')
  const rawThumb = String(reel.metrics?.thumbnail || '')

  useEffect(() => {
    setImgErr(false)
    setDolor(reel.classification?.dolor || '')
    setAngulos((reel.classification?.angulos || []).join(', '))
    setCta(reel.classification?.cta || '')
  }, [rawThumb, reel.classification?.dolor, reel.classification?.angulos, reel.classification?.cta])

  const thumb = rawThumb && !imgErr ? `/api/proxy-image?url=${encodeURIComponent(rawThumb)}` : ''
  const plays = Number(reel.metrics?.plays) || 0
  const likes = Number(reel.metrics?.likes) || 0
  const comments = Number(reel.metrics?.comments_count ?? reel.metrics?.comments) || 0
  const shares = Number(reel.metrics?.shares) || 0
  const reach = Number(reel.metrics?.reach) || 0
  const cpc = reel.chats > 0 ? reel.cash / reel.chats : 0
  const title = reel.title || reel.notes?.substring(0, 60) || 'Sin titulo'

  return (
    <div className={`glass-card overflow-hidden transition-all ${isExpanded ? 'col-span-4 grid grid-cols-[300px_1fr]' : 'cursor-pointer'}`} onClick={!isExpanded ? onToggle : undefined}>
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
          <a
            href={reel.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="absolute top-2 right-2 rounded-md bg-black/50 p-1.5 text-white/70 hover:text-white transition-colors backdrop-blur-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
          </a>
        )}
      </div>

      {!isExpanded && (
        <div className="p-3">
          <div className="text-[12px] font-medium truncate">{title}</div>
          <div className="text-[11px] text-[var(--text3)] mt-0.5">{reel.chats} chats · CPC {formatCash(cpc)}</div>
          {dolor && (
            <div className="mt-2 flex flex-wrap gap-1">
              <span className="rounded-md border border-red-500/20 bg-red-500/15 px-1.5 py-0.5 text-[9px] font-medium text-red-400">{dolor}</span>
            </div>
          )}
        </div>
      )}

      {isExpanded && (
        <div className="p-5 space-y-4 overflow-y-auto max-h-[500px]">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[14px] font-semibold">{title}</div>
              <div className="text-[11px] text-[var(--text3)] mt-0.5">{reel.published_at?.split('T')[0]}</div>
            </div>
            <div className="flex items-center gap-2">
              {reel.url && (
                <a href={reel.url} target="_blank" rel="noopener noreferrer" className="rounded-md bg-[var(--bg4)] px-3 py-1.5 text-[10px] text-[var(--text2)] hover:text-[var(--text)] transition-colors">
                  Ver en Instagram →
                </a>
              )}
              <button onClick={onToggle} className="rounded-md bg-[var(--bg4)] px-3 py-1.5 text-[10px] text-[var(--text3)] hover:text-[var(--text)]">✕ Cerrar</button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div className="rounded-lg bg-[var(--bg4)] p-3 text-center">
              <div className="text-[8px] uppercase tracking-wider text-[var(--text3)]">Cash</div>
              <input
                type="number"
                value={reel.cash || 0}
                onChange={(e) => onUpdate(reel.id, 'cash', Number(e.target.value) || 0)}
                className="w-full bg-transparent text-center font-mono-num text-[16px] font-bold text-[var(--green)] outline-none"
              />
            </div>
            <div className="rounded-lg bg-[var(--bg4)] p-3 text-center">
              <div className="text-[8px] uppercase tracking-wider text-[var(--text3)]">Chats</div>
              <input
                type="number"
                value={reel.chats || 0}
                onChange={(e) => onUpdate(reel.id, 'chats', Number(e.target.value) || 0)}
                className="w-full bg-transparent text-center font-mono-num text-[16px] font-bold text-[var(--text)] outline-none"
              />
            </div>
            <div className="rounded-lg bg-[var(--bg4)] p-3 text-center">
              <div className="text-[8px] uppercase tracking-wider text-[var(--text3)]">CPC</div>
              <div className="font-mono-num text-[16px] font-bold">{formatCash(cpc)}</div>
            </div>
            <div className="rounded-lg bg-[var(--bg4)] p-3 text-center">
              <div className="text-[8px] uppercase tracking-wider text-[var(--text3)]">Plays</div>
              <div className="font-mono-num text-[16px] font-bold">{formatInt(plays)}</div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div className="rounded-lg bg-[var(--bg4)] p-2.5 text-center">
              <div className="text-[8px] uppercase tracking-wider text-[var(--text3)]">Likes</div>
              <div className="font-mono-num text-[14px] font-bold">{formatInt(likes)}</div>
            </div>
            <div className="rounded-lg bg-[var(--bg4)] p-2.5 text-center">
              <div className="text-[8px] uppercase tracking-wider text-[var(--text3)]">Comentarios</div>
              <div className="font-mono-num text-[14px] font-bold">{formatInt(comments)}</div>
            </div>
            <div className="rounded-lg bg-[var(--bg4)] p-2.5 text-center">
              <div className="text-[8px] uppercase tracking-wider text-[var(--text3)]">Shares</div>
              <div className="font-mono-num text-[14px] font-bold">{formatInt(shares)}</div>
            </div>
            <div className="rounded-lg bg-[var(--bg4)] p-2.5 text-center">
              <div className="text-[8px] uppercase tracking-wider text-[var(--text3)]">Reach</div>
              <div className="font-mono-num text-[14px] font-bold">{formatInt(reach)}</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="mb-1 text-[9px] font-medium uppercase tracking-wider text-[var(--text3)]">Dolor</div>
              <select
                value={dolor}
                onChange={(e) => setDolor(e.target.value)}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[12px] text-[var(--text)] outline-none cursor-pointer"
              >
                <option value="">Seleccionar...</option>
                {masterLists.dolores.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </div>
            <div>
              <div className="mb-1 text-[9px] font-medium uppercase tracking-wider text-[var(--text3)]">Angulos</div>
              <select
                value={angulos}
                onChange={(e) => setAngulos(e.target.value)}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[12px] text-[var(--text)] outline-none cursor-pointer"
              >
                <option value="">Seleccionar...</option>
                {masterLists.angulos.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </div>
            <div>
              <div className="mb-1 text-[9px] font-medium uppercase tracking-wider text-[var(--text3)]">CTA</div>
              <select
                value={cta}
                onChange={(e) => setCta(e.target.value)}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[12px] text-[var(--text)] outline-none cursor-pointer"
              >
                <option value="">Seleccionar...</option>
                {masterLists.ctas.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function formatCash(value: number): string {
  const n = Number(value || 0)
  return `$${Math.round(n).toLocaleString('es-AR')}`
}

function formatInt(value: number): string {
  const n = Number(value || 0)
  return Math.trunc(n).toLocaleString('es-AR')
}

