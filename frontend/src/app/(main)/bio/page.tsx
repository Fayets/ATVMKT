'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMonthContext } from '@/shared/components/app-providers'
import { MonthSelector } from '@/shared/components/month-selector'
import { useToast } from '@/shared/components/toast'
import { useSupabase } from '@/shared/hooks/use-supabase'
import { formatCash } from '@/shared/lib/supabase/queries'
import { canonicalLeadStatus } from '@/features/leads/types'

type BioLead = {
  id: string
  handle: string
  nombre: string | null
  avatar_url: string | null
  subscribed_at: string | null
  keyword: string | null
  /** Vía (Airtable): Perfil, Automático - ManyChat, etc. */
  via?: string | null
  airtable_found: boolean
  airtable_record_id: string | null
  status: string | null
  setter: string | null
  programa: string | null
  pago: number | null
  fecha_agendo: string | null
  llamada_url: string | null
  dolores: string | null
  razon_compra: string | null
  notas: string | null
  manychat_chat_url: string | null
}

type BioMetrics = {
  total_leads: number
  agendaron: number
  cerrados: number
  cash_total: number
  cash_por_lead: number
  tasa_conversion: number
  cash_por_chat: number
  tasa_respuesta_auto: number | null
}

type BioLeadsResponse = {
  leads?: BioLead[]
  manychat_active?: boolean
  connected_to_airtable?: boolean
  detail?: string
}

type BioViaOptionsResponse = {
  options?: string[]
}

/** Opciones del Status en Airtable (sin Pendiente en el dropdown BIO). */
const STATUS_OPTIONS = [
  'Seguimiento',
  'Descalificado',
  'Cerrado',
  'No show',
  'Seña',
] as const

const AR_TZ = 'America/Argentina/Buenos_Aires'

/** Fecha agendó: dd/mm/año en Argentina; si no es parseable, se muestra el texto tal cual. */
function formatCashPorChat(n: number): string {
  if (n === 0) return '$0'
  return `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatFechaAgendoDisplay(raw: string | null | undefined): string {
  if (!raw?.trim()) return '—'
  const s = raw.trim()
  const isoYmd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (isoYmd) {
    const [, y, mo, d] = isoYmd
    return `${d}/${mo}/${y}`
  }
  const t = Date.parse(s)
  if (Number.isNaN(t)) return s
  return new Date(t).toLocaleDateString('es-AR', {
    timeZone: AR_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export default function BioPage() {
  const { month, options, setMonth } = useMonthContext()
  const { toast } = useToast()
  const { ready, userId } = useSupabase()

  const [loading, setLoading] = useState(true)
  const [loadingMetrics, setLoadingMetrics] = useState(true)
  const [rows, setRows] = useState<BioLead[]>([])
  const [metrics, setMetrics] = useState<BioMetrics>({
    total_leads: 0,
    agendaron: 0,
    cerrados: 0,
    cash_total: 0,
    cash_por_lead: 0,
    tasa_conversion: 0,
    cash_por_chat: 0,
    tasa_respuesta_auto: null,
  })
  const [expanded, setExpanded] = useState<string | null>(null)
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null)
  const [viaFilter, setViaFilter] = useState<string>('all')
  const [viaOptionsFromApi, setViaOptionsFromApi] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState<string>('')

  const apiBase =
    (process.env.NEXT_PUBLIC_BACKEND_URL || '').trim().replace(/\/$/, '') || '/api-backend'

  const fetchLeads = useCallback(async () => {
    if (!ready || !userId) return
    setLoading(true)
    try {
      const res = await fetch(`${apiBase}/api/bio/leads?month=${encodeURIComponent(month)}`, {
        headers: { 'X-User-Id': userId },
      })
      const txt = await res.text()
      const data = (() => {
        try { return txt ? JSON.parse(txt) : {} } catch { return { detail: txt } }
      })() as BioLeadsResponse

      if (!res.ok) {
        toast(`Error al cargar BIO: ${data.detail || res.statusText}`)
        setRows([])
        return
      }
      setRows(Array.isArray(data.leads) ? data.leads : [])
    } finally {
      setLoading(false)
    }
  }, [ready, userId, apiBase, month, toast])

  const fetchMetrics = useCallback(async () => {
    if (!ready || !userId) return
    setLoadingMetrics(true)
    try {
      const res = await fetch(`${apiBase}/api/bio/metrics?month=${encodeURIComponent(month)}`, {
        headers: { 'X-User-Id': userId },
      })
      const txt = await res.text()
      const data = (() => {
        try { return txt ? JSON.parse(txt) : {} } catch { return {} }
      })() as Partial<BioMetrics>
      if (res.ok) {
        setMetrics({
          total_leads: Number(data.total_leads || 0),
          agendaron: Number(data.agendaron || 0),
          cerrados: Number(data.cerrados || 0),
          cash_total: Number(data.cash_total || 0),
          cash_por_lead: Number(data.cash_por_lead || 0),
          tasa_conversion: Number(data.tasa_conversion || 0),
          cash_por_chat: Number(data.cash_por_chat ?? 0),
          tasa_respuesta_auto:
            data.tasa_respuesta_auto === null || data.tasa_respuesta_auto === undefined
              ? null
              : Number(data.tasa_respuesta_auto),
        })
      }
    } finally {
      setLoadingMetrics(false)
    }
  }, [ready, userId, apiBase, month])

  const fetchViaOptions = useCallback(async () => {
    if (!ready || !userId) return
    try {
      const res = await fetch(`${apiBase}/api/bio/via-options`, {
        headers: { 'X-User-Id': userId },
      })
      const txt = await res.text()
      const data = (() => {
        try { return txt ? JSON.parse(txt) : {} } catch { return {} }
      })() as BioViaOptionsResponse
      if (res.ok && Array.isArray(data.options)) {
        setViaOptionsFromApi(data.options)
      } else {
        setViaOptionsFromApi([])
      }
    } catch {
      setViaOptionsFromApi([])
    }
  }, [ready, userId, apiBase])

  useEffect(() => {
    fetchLeads()
    fetchMetrics()
  }, [fetchLeads, fetchMetrics])

  useEffect(() => {
    fetchViaOptions()
  }, [fetchViaOptions])

  const patchStatusOptimistic = async (lead: BioLead, nextStatus: string) => {
    if (!userId || !lead.airtable_record_id) return
    const prevRows = rows
    setUpdatingStatusId(lead.id)
    const normalized = canonicalLeadStatus(nextStatus)
    setRows((prev) => prev.map((r) => (r.id === lead.id ? { ...r, status: normalized } : r)))
    try {
      const res = await fetch(`${apiBase}/api/bio/leads/${encodeURIComponent(lead.airtable_record_id)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ status: normalized }),
      })
      if (!res.ok) {
        const tx = await res.text()
        setRows(prevRows)
        toast(`No se pudo actualizar estado: ${tx || res.statusText}`)
        return
      }
      const updated = (await res.json()) as Partial<BioLead>
      setRows((prev) => prev.map((r) => (r.id === lead.id ? { ...r, status: updated.status || normalized } : r)))
      fetchMetrics()
    } catch (e) {
      setRows(prevRows)
      toast(`No se pudo actualizar estado: ${(e as Error).message}`)
    } finally {
      setUpdatingStatusId(null)
    }
  }

  const visibleRows = useMemo(() => {
    let out = rows
    if (viaFilter !== 'all') {
      out = out.filter((r) => (r.via || '').trim() === viaFilter)
    }
    const q = searchQuery.trim().toLowerCase()
    if (!q) return out
    return out.filter((r) => {
      const handle = (r.handle || '').toLowerCase()
      const nombre = (r.nombre || '').toLowerCase()
      const keyword = (r.keyword || '').toLowerCase()
      return handle.includes(q) || nombre.includes(q) || keyword.includes(q)
    })
  }, [rows, viaFilter, searchQuery])

  if (!ready || loading) {
    return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">BIO</h2>
          <p className="mt-1 text-[12px] text-[var(--text3)]">Leads que respondieron el bot de ManyChat</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por IG, nombre o keyword"
            className="w-64 rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--text3)]"
          />
          <select
            value={viaFilter}
            onChange={(e) => setViaFilter(e.target.value)}
            className="max-w-[200px] rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[12px] text-[var(--text)] outline-none truncate"
            title="Filtrar por Vía"
          >
            <option value="all">Todos</option>
            {viaOptionsFromApi.map((op) => (
              <option key={op} value={op} title={op}>
                {op}
              </option>
            ))}
          </select>
          <MonthSelector month={month} options={options} onChange={setMonth} />
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <div className="glass-card p-5">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Total leads</div>
          <div className="font-mono-num mt-1 text-3xl font-bold">{loadingMetrics ? '—' : metrics.total_leads}</div>
        </div>
        <div className="glass-card p-5">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Agendaron</div>
          <div className="font-mono-num mt-1 text-3xl font-bold">{loadingMetrics ? '—' : metrics.agendaron}</div>
        </div>
        <div className="glass-card p-5">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Cerrados</div>
          <div className="font-mono-num mt-1 text-3xl font-bold">{loadingMetrics ? '—' : metrics.cerrados}</div>
        </div>
        <div className="glass-card p-5">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Tasa de agenda</div>
          <div className="font-mono-num mt-1 text-3xl font-bold">{loadingMetrics ? '—' : `${metrics.tasa_conversion.toFixed(1)}%`}</div>
        </div>
        <div className="glass-card p-5">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Cash por chat</div>
          <div className="font-mono-num mt-1 text-3xl font-bold">{loadingMetrics ? '—' : formatCashPorChat(metrics.cash_por_chat)}</div>
        </div>
        <div className="glass-card p-5">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Tasa resp. auto</div>
          <div className="font-mono-num mt-1 text-3xl font-bold">
            {loadingMetrics ? '—' : metrics.tasa_respuesta_auto === null ? '—' : `${metrics.tasa_respuesta_auto.toFixed(1)}%`}
          </div>
          <div className="mt-1 text-[10px] leading-tight text-[var(--text3)]">respondieron / entraron al bot</div>
        </div>
      </div>

      {visibleRows.length === 0 ? (
        <div className="py-12 text-center text-[13px] text-[var(--text3)]">Sin leads de ManyChat para este período/filtro</div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-[1.4fr_1fr_0.9fr_0.9fr_0.9fr_0.8fr_70px] gap-3 px-4 py-2">
            {['Instagram', 'Estado', 'Keyword', 'Setter', 'Programa', 'Fecha', ''].map((h) => (
              <div key={h} className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">{h}</div>
            ))}
          </div>

          {visibleRows.map((lead) => (
            <div key={lead.id} className="glass-card">
              <div className="grid grid-cols-[1.4fr_1fr_0.9fr_0.9fr_0.9fr_0.8fr_70px] gap-3 px-4 py-3 items-center">
                <div className="min-w-0">
                  <span className="truncate text-[13px]">{lead.handle}</span>
                </div>

                <div>
                  {!lead.airtable_found ? (
                    <span className="inline-flex rounded-md border border-[var(--border2)] bg-[var(--bg4)] px-2 py-1 text-[10px] font-medium text-[var(--text3)]">No agendó</span>
                  ) : (
                    <select
                      value={canonicalLeadStatus(lead.status || 'Seguimiento')}
                      disabled={updatingStatusId === lead.id}
                      onChange={(e) => patchStatusOptimistic(lead, e.target.value)}
                      className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-2 py-1.5 text-[12px] outline-none"
                    >
                      {STATUS_OPTIONS.map((op) => <option key={op} value={op}>{op}</option>)}
                    </select>
                  )}
                </div>

                <div className="text-[12px] text-[var(--text2)] truncate">{lead.keyword || '—'}</div>
                <div className="text-[12px] text-[var(--text2)] truncate">{lead.setter || '—'}</div>
                <div className="text-[12px] text-[var(--text2)] truncate">{lead.programa || '—'}</div>
                <div className="text-[12px] text-[var(--text3)]">
                  {lead.subscribed_at ? new Date(lead.subscribed_at).toLocaleDateString('es-AR', { timeZone: AR_TZ, day: '2-digit', month: '2-digit' }) : '—'}
                </div>
                <button
                  type="button"
                  onClick={() => setExpanded((p) => (p === lead.id ? null : lead.id))}
                  className="rounded-md border border-[var(--border2)] px-2 py-1 text-[10px] font-semibold uppercase text-[var(--text2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  {expanded === lead.id ? 'Ocultar' : 'Detalle'}
                </button>
              </div>

              {expanded === lead.id && (
                <div className="px-4 pb-4">
                  <div className="rounded-lg bg-[var(--bg3)] border border-[var(--border2)] p-4 grid grid-cols-2 gap-4 text-[12px]">
                    <div className="space-y-1">
                      <div><span className="text-[var(--text3)]">Nombre:</span> {lead.nombre || '—'}</div>
                      <div><span className="text-[var(--text3)]">Vía:</span> {lead.via || '—'}</div>
                      <div><span className="text-[var(--text3)]">Instagram:</span> {lead.handle}</div>
                      <div><span className="text-[var(--text3)]">Entró al bot:</span> {lead.subscribed_at ? new Date(lead.subscribed_at).toLocaleString('es-AR', { timeZone: AR_TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—'}</div>
                      <div><span className="text-[var(--text3)]">Keyword:</span> {lead.keyword || '—'}</div>
                      <div><span className="text-[var(--text3)]">Cash por lead:</span> {formatCash(Number(lead.pago || 0))}</div>
                    </div>

                    {!lead.airtable_found ? (
                      <div className="flex items-center">
                        <div className="rounded-lg border border-[var(--border2)] bg-[var(--bg4)] px-4 py-3 text-[var(--text3)]">
                          Este lead aún no agendó una llamada
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div><span className="text-[var(--text3)]">Setter:</span> {lead.setter || '—'}</div>
                        <div><span className="text-[var(--text3)]">Programa:</span> {lead.programa || '—'}</div>
                        <div><span className="text-[var(--text3)]">Pagó:</span> {formatCash(Number(lead.pago || 0))}</div>
                        <div><span className="text-[var(--text3)]">Fecha agendó:</span> {formatFechaAgendoDisplay(lead.fecha_agendo)}</div>
                        <div><span className="text-[var(--text3)]">Dolores:</span> {lead.dolores || '—'}</div>
                        <div><span className="text-[var(--text3)]">Razón compra:</span> {lead.razon_compra || '—'}</div>
                        <div><span className="text-[var(--text3)]">Notas:</span> {lead.notas || '—'}</div>
                        {lead.llamada_url ? (
                          <a
                            href={lead.llamada_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex rounded-md bg-[var(--accent)] px-3 py-1.5 text-[10px] font-semibold uppercase text-white hover:opacity-90"
                          >
                            Ver llamada
                          </a>
                        ) : (
                          <div className="text-[var(--text3)]">Sin link de llamada</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
