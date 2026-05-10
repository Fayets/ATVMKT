'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useMonthContext } from '@/shared/components/app-providers'
import { MonthSelector } from '@/shared/components/month-selector'
import { Modal } from '@/shared/components/modal'
import { useToast } from '@/shared/components/toast'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { formatCash } from '@/shared/lib/format-utils'
import { apiFetch } from '@/lib/api'
import { AgendaPointPickerModal } from './agenda-point-picker-modal'
import {
  Lead,
  ColumnDef,
  SortConfig,
  FilterConfig,
  STATUS_TABS,
  buildColumns,
  canonicalLeadStatus,
  ORIGIN_OPTIONS,
  AGENDO_EN_OPTIONS,
  PROGRAM_COLORS,
} from '../types'

type AgendaReelLookup = { title: string; publishedAt: string | null }
type AgendaSequenceLookup = { title: string; sequenceDate: string | null }

type AgendaYoutubeLookup = { title: string; publishedAt: string | null }

/** Fecha para badge Pto agenda (ISO reel o YYYY-MM-DD de historia). */
function formatAgendaPointDate(raw: string | null | undefined): string {
  if (raw == null || !String(raw).trim()) return '—'
  const s = String(raw).trim()
  const head = s.includes('T') ? s.split('T')[0] : s.split(' ')[0]
  if (/^\d{4}-\d{2}-\d{2}$/.test(head)) {
    const [y, mo, d] = head.split('-').map(Number)
    return `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}`
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const LEGACY_AGENDA_SNIPPET_LEN = 42

function formatAgendaPointBadgeText(
  raw: string | null | undefined,
  lookups: {
    reels: Record<string, AgendaReelLookup>
    sequences: Record<string, AgendaSequenceLookup>
    youtube?: Record<string, AgendaYoutubeLookup>
  },
): string {
  const k = String(raw || '').trim()
  if (!k) return ''
  if (k.toLowerCase() === 'bio') return '[BIO]'
  const yt = /^youtube:(\d+)$/i.exec(k)
  if (yt) {
    const id = yt[1]
    const ent = lookups.youtube?.[`youtube:${id}`] ?? lookups.youtube?.[id]
    if (ent) return `[YT] · ${formatAgendaPointDate(ent.publishedAt)}`
    return `[YT] · —`
  }
  const reel = lookups.reels[k]
  if (reel) return `[REEL] · ${formatAgendaPointDate(reel.publishedAt)}`

  let seq = lookups.sequences[k]
  if (!seq) {
    const m = /^story:(\d+)$/i.exec(k)
    if (m) {
      const sid = m[1]
      seq = lookups.sequences[`story:${sid}`] ?? lookups.sequences[sid]
    }
  }
  if (!seq && /^\d+$/.test(k)) {
    seq = lookups.sequences[k] ?? lookups.sequences[`story:${k}`]
  }
  if (seq) return `[HISTORIA] · ${formatAgendaPointDate(seq.sequenceDate)}`

  if (/^story:\d+$/i.test(k)) return `[HISTORIA] · —`

  if (k.length > LEGACY_AGENDA_SNIPPET_LEN) return `${k.slice(0, LEGACY_AGENDA_SNIPPET_LEN)}…`
  return k
}

/** Setter/closer: incluye el nombre guardado aunque ya no esté en el equipo activo. */
function teamRoleSelectOptions(
  lead: Lead,
  field: 'setter' | 'closer',
  parentOpts: string[],
): string[] {
  const v = String(lead[field] || '').trim()
  if (!v || parentOpts.includes(v)) return parentOpts
  const rest = parentOpts.filter((x) => x !== '')
  return ['', ...[...rest, v].sort((a, b) => a.localeCompare(b, 'es'))]
}

const PROGRAM_COLOR_PALETTE = ['#22C55E', '#3B82F6', '#F59E0B', '#A855F7', '#EC4899', '#06B6D4', '#EAB308', '#64748B']

function programOfferedSelectOptions(lead: Lead, parentOpts: string[]): string[] {
  const v = String(lead.program_offered || '').trim()
  if (!v || parentOpts.includes(v)) return parentOpts
  const rest = parentOpts.filter((x) => x !== '')
  return ['', ...[...rest, v].sort((a, b) => a.localeCompare(b, 'es'))]
}

/** Columna Email (solo vista): extrae de `notes` la línea `Calendly email: …`. */
function calendlyEmailFromNotes(notes: string | null | undefined): string | null {
  if (notes == null || !String(notes).trim()) return null
  const m = /Calendly email:\s*(.+)/.exec(String(notes))
  const cap = m?.[1]?.trim()
  return cap || null
}

/** ISO `YYYY-MM-DD` o `…T00:00:00…` → solo fecha `dd/mm/aaaa`; si no parsea, null. */
function formatIsoDateToDdMmYyyy(raw: string | null | undefined): string | null {
  const s = raw != null ? String(raw).trim() : ''
  if (!s) return null
  const head = s.includes('T') ? s.split('T')[0] : s.split(' ')[0]
  if (!/^\d{4}-\d{2}-\d{2}$/.test(head)) return null
  const [y, mo, d] = head.split('-').map(Number)
  if (!y || !mo || !d) return null
  return `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}`
}

/** Valor inicial para `<input type="date">` desde ISO completo. */
function toHtmlDateInputValue(raw: string | null | undefined): string {
  const s = raw != null ? String(raw).trim() : ''
  if (!s) return ''
  const head = s.includes('T') ? s.split('T')[0] : s.split(' ')[0]
  if (/^\d{4}-\d{2}-\d{2}$/.test(head)) return head
  return s.slice(0, 10)
}

function agendoEnLooksLikeIso(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(s.trim())
}

/** Valor guardado en API/BD (para PATCH y value del select). Solo canal Chat/Youtube. */
function agendoEnStoredValue(lead: Lead): string {
  const v = lead.agendo_en
  if (v != null && String(v).trim() !== '') {
    const t = String(v).trim()
    if (agendoEnLooksLikeIso(t)) return 'Chat'
    return t
  }
  return 'Chat'
}

/** Canal (Chat/Youtube). Fechas legadas en agendo_en se muestran como Chat; la fecha de la llamada elegida por el cliente va en Call (`scheduled_at`). */
function formatAgendoEnForDisplay(raw: string | null | undefined): string {
  const s = raw != null ? String(raw).trim() : ''
  if (!s) return 'Chat'
  if (agendoEnLooksLikeIso(s)) return 'Chat'
  return s
}

function agendoEnSelectOptions(lead: Lead): string[] {
  const v = agendoEnStoredValue(lead)
  const base: string[] = [...AGENDO_EN_OPTIONS]
  if (!base.includes(v)) base.push(v)
  return base
}

function originDisplayValue(lead: Lead): string {
  const o = lead.origin
  if (o != null && String(o).trim() !== '') return String(o).trim()
  return 'Setter'
}

function originSelectOptions(lead: Lead): string[] {
  const v = originDisplayValue(lead)
  const base: string[] = [...ORIGIN_OPTIONS]
  if (!base.includes(v)) base.push(v)
  return base
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN PAGE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function LeadsPage() {
  const { month, options, setMonth } = useMonthContext()
  const { toast } = useToast()
  const { ready, userId } = useAuthUser()

  // Data
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)

  const [setterNames, setSetterNames] = useState<string[]>([])
  const [closerNames, setCloserNames] = useState<string[]>([])
  const [offeredPrograms, setOfferedPrograms] = useState<{ id: number; name: string; price_usd: number }[]>([])

  const programColumnMeta = useMemo(() => {
    const names = offeredPrograms
      .map((p) => String(p.name ?? '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'es'))
    const colors: Record<string, string> = { ...PROGRAM_COLORS }
    names.forEach((n, i) => {
      if (!colors[n]) colors[n] = PROGRAM_COLOR_PALETTE[i % PROGRAM_COLOR_PALETTE.length]
    })
    return { options: ['', ...names] as string[], colors }
  }, [offeredPrograms])

  // Dynamic columns based on team members + programas (Ajustes)
  const COLUMNS = useMemo(
    () => buildColumns(setterNames, closerNames, programColumnMeta),
    [setterNames, closerNames, programColumnMeta],
  )

  // UI state
  const [statusTab, setStatusTab] = useState('Todos')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortConfig>({ field: 'date', dir: 'desc' })
  const [filters, setFilters] = useState<FilterConfig[]>([])
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() =>
    new Set(buildColumns([], []).filter(c => c.defaultVisible).map(c => c.key))
  )
  const [groupBy, setGroupBy] = useState<string | null>(null)
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())

  // New row
  const [addingRow, setAddingRow] = useState(false)

  // Inline edit
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null)
  const [textPreview, setTextPreview] = useState<{ title: string; text: string } | null>(null)

  // Toolbar dropdowns
  const [showFilterPanel, setShowFilterPanel] = useState(false)
  const [showColumnPanel, setShowColumnPanel] = useState(false)
  const [showSortPanel, setShowSortPanel] = useState(false)
  const [showGroupPanel, setShowGroupPanel] = useState(false)
  const [deleteConfirmIds, setDeleteConfirmIds] = useState<string[] | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const [agendaLookups, setAgendaLookups] = useState<{
    reels: Record<string, AgendaReelLookup>
    sequences: Record<string, AgendaSequenceLookup>
    youtube: Record<string, AgendaYoutubeLookup>
  }>({
    reels: {},
    sequences: {},
    youtube: {},
  })
  const [agendaModalLead, setAgendaModalLead] = useState<Lead | null>(null)
  const [funnelModalLead, setFunnelModalLead] = useState<Lead | null>(null)

  // ── Data fetching ──
  const fetchTeamMembers = useCallback(async () => {
    if (!ready || !userId) {
      setSetterNames([])
      setCloserNames([])
      return
    }
    try {
      const res = await apiFetch('/team/members')
      const data = (await res.json().catch(() => ({}))) as {
        setters?: { nombre: string; activo?: boolean }[]
        closers?: { nombre: string; activo?: boolean }[]
      }
      if (!res.ok) {
        setSetterNames([])
        setCloserNames([])
        return
      }
      const active = (m: { nombre: string; activo?: boolean }) =>
        m.activo !== false && String(m.nombre || '').trim()
      const sn = [...new Set((data.setters ?? []).filter(active).map((m) => m.nombre.trim()))].sort(
        (a, b) => a.localeCompare(b, 'es'),
      )
      const cn = [...new Set((data.closers ?? []).filter(active).map((m) => m.nombre.trim()))].sort(
        (a, b) => a.localeCompare(b, 'es'),
      )
      setSetterNames(sn)
      setCloserNames(cn)
    } catch {
      setSetterNames([])
      setCloserNames([])
    }
  }, [ready, userId])

  const fetchPrograms = useCallback(async () => {
    if (!ready || !userId) {
      setOfferedPrograms([])
      return
    }
    try {
      const res = await apiFetch('/programs')
      const data = (await res.json().catch(() => ({}))) as {
        programs?: { id: number; name: string; price_usd: number }[]
      }
      if (!res.ok) {
        setOfferedPrograms([])
        return
      }
      setOfferedPrograms(Array.isArray(data.programs) ? data.programs : [])
    } catch {
      setOfferedPrograms([])
    }
  }, [ready, userId])

  const fetchLeads = useCallback(async () => {
    if (!ready || !userId) {
      setLeads([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (month) params.set('month', month)
      const qs = params.toString()
      const res = await apiFetch(`/leads${qs ? `?${qs}` : ''}`)
      const raw = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail = typeof raw === 'object' && raw && 'detail' in raw
          ? String((raw as { detail: unknown }).detail)
          : res.statusText
        toast(`Error al cargar leads: ${detail}`)
        setLeads([])
        return
      }
      const data = raw as { leads?: Lead[] }
      setLeads(Array.isArray(data.leads) ? data.leads : [])
    } catch {
      toast('Error al cargar leads')
      setLeads([])
    } finally {
      setLoading(false)
    }
  }, [ready, userId, month, toast])

  const loadAgendaLookups = useCallback(async () => {
    if (!ready || !userId) return
    const reels: Record<string, AgendaReelLookup> = {}
    const sequences: Record<string, AgendaSequenceLookup> = {}
    const youtube: Record<string, AgendaYoutubeLookup> = {}
    try {
      let page = 1
      for (;;) {
        const res = await apiFetch(`/reels?page=${page}&page_size=50&skip_agg=1`)
        const data = (await res.json().catch(() => ({}))) as {
          reels?: { id: string; title: string | null; published_at?: string | null }[]
          total_pages?: number
        }
        if (!res.ok) break
        for (const r of data.reels || []) {
          reels[String(r.id)] = {
            title: (r.title && r.title.trim()) || `Reel ${r.id}`,
            publishedAt: r.published_at ?? null,
          }
        }
        const tp = Math.max(1, data.total_pages ?? 1)
        if (page >= tp) break
        page += 1
        if (page > 30) break
      }
      const sr = await apiFetch('/stories/sequences?all_months=true')
      const seqData = (await sr.json().catch(() => [])) as {
        id: number
        sequence_date: string
        title: string | null
      }[]
      if (sr.ok && Array.isArray(seqData)) {
        for (const s of seqData) {
          const meta = {
            title:
              (s.title && s.title.trim()) ||
              (s.sequence_date ? `Historia ${s.sequence_date}` : `Historia #${s.id}`),
            sequenceDate: s.sequence_date ?? null,
          }
          sequences[String(s.id)] = meta
          sequences[`story:${s.id}`] = meta
        }
      }
      let yp = 1
      for (;;) {
        const yr = await apiFetch(`/youtube/videos?page=${yp}&page_size=50&skip_agg=1`)
        const yd = (await yr.json().catch(() => ({}))) as {
          videos?: { id: string; title: string | null; published_at?: string | null }[]
          total_pages?: number
        }
        if (!yr.ok) break
        for (const v of yd.videos || []) {
          const id = String(v.id)
          const meta = {
            title: (v.title && v.title.trim()) || `YouTube ${id}`,
            publishedAt: v.published_at ?? null,
          }
          youtube[id] = meta
          youtube[`youtube:${id}`] = meta
        }
        const ytp = Math.max(1, yd.total_pages ?? 1)
        if (yp >= ytp) break
        yp += 1
        if (yp > 40) break
      }
      setAgendaLookups({ reels, sequences, youtube })
    } catch {
      /* noop */
    }
  }, [ready, userId])

  useEffect(() => {
    void loadAgendaLookups()
  }, [loadAgendaLookups])

  useEffect(() => {
    void fetchTeamMembers()
    void fetchPrograms()
  }, [fetchTeamMembers, fetchPrograms])

  useEffect(() => {
    const refresh = () => {
      void fetchPrograms()
    }
    window.addEventListener('offered-programs-updated', refresh)
    return () => window.removeEventListener('offered-programs-updated', refresh)
  }, [fetchPrograms])
  useEffect(() => { fetchLeads() }, [fetchLeads])
  useEffect(() => { setSelectedRows(new Set()) }, [month, statusTab])

  // ── CRUD ──
  const executeDelete = useCallback(
    async (ids: string[]) => {
      if (!ready) return
      if (!userId) {
        toast('No hay sesión: iniciá sesión de nuevo para eliminar leads.')
        return
      }
      if (ids.length === 0) return
      setDeleteBusy(true)
      let ok = 0
      let fail = 0
      let lastDetail = ''
      try {
        for (const id of ids) {
          const res = await apiFetch(`/leads/${encodeURIComponent(id)}`, { method: 'DELETE' })
          if (res.ok) {
            ok++
          } else {
            fail++
            const raw = await res.json().catch(() => ({}))
            const detail =
              typeof raw === 'object' && raw && 'detail' in raw
                ? String((raw as { detail: unknown }).detail)
                : res.statusText
            lastDetail = detail || lastDetail
          }
        }
      } catch (e) {
        toast(`Error de red al eliminar: ${e instanceof Error ? e.message : 'desconocido'}`)
        return
      } finally {
        setDeleteBusy(false)
      }
      if (fail === 0) {
        toast(ids.length === 1 ? 'Cliente eliminado.' : `${ok} clientes eliminados.`)
      } else if (ok > 0) {
        toast(`Eliminados: ${ok}. Fallaron: ${fail}.${lastDetail ? ` (${lastDetail})` : ''}`)
      } else {
        toast(
          lastDetail
            ? `No se pudo eliminar: ${lastDetail}`
            : 'No se pudo eliminar. Revisá permisos o que el lead exista.',
        )
      }
      setSelectedRows(new Set())
      await fetchLeads()
    },
    [ready, userId, toast, fetchLeads],
  )

  const handleInlineUpdate = useCallback(
    async (id: string, field: string, value: string | number | null) => {
      if (!ready || !userId) return
      const payload: Record<string, unknown> =
        field === 'origin'
          ? { origen: value === null || value === '' ? 'Setter' : String(value) }
          : field === 'agendo_en'
              ? { agendo_en: value === null || value === '' ? 'Chat' : String(value) }
              : field === 'entry_channel'
                ? { via: value === null || value === '' ? '' : String(value) }
                : field === 'agenda_point'
                  ? { punto_agenda: value === null || value === '' ? '' : String(value) }
                  : { [field]: value }
      try {
        const res = await apiFetch(`/leads/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const raw = await res.json().catch(() => ({}))
        if (!res.ok) {
          const detail =
            typeof raw === 'object' && raw && 'detail' in raw
              ? String((raw as { detail: unknown }).detail)
              : res.statusText
          toast(`No se guardó: ${detail}`)
          await fetchLeads()
          return
        }
        const updated = raw as Lead
        setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...updated } : l)))
      } catch (e) {
        toast(`Error al guardar: ${e instanceof Error ? e.message : 'desconocido'}`)
        await fetchLeads()
      } finally {
        setEditingCell(null)
      }
    },
    [ready, userId, toast, fetchLeads],
  )

  const handleAddRow = async () => {
    toast('Agregar filas no disponible por ahora.')
  }

  // ── Filtering & Sorting ──
  const filtered = useMemo(() => {
    let result = [...leads]

    // Mes: GET /leads ya manda ?month= y el backend filtra; no re-filtrar por l.month
    // (evita ocultar filas si month del JSON y el criterio del API difieren).

    // Status tab (comparación canónica de texto / mayúsculas)
    if (statusTab === 'Cerrados') {
      result = result.filter(l => {
        const c = canonicalLeadStatus(l.status)
        return c === 'Cerrado' || c === 'Seña'
      })
    } else if (statusTab !== 'Todos') {
      const tabMap: Record<string, string> = { 'No show': 'No show' }
      const matchStatus = tabMap[statusTab] || statusTab
      result = result.filter(l => canonicalLeadStatus(l.status) === matchStatus)
    }

    // Search
    if (search) {
      const s = search.toLowerCase()
      result = result.filter(l =>
        l.client_name?.toLowerCase().includes(s) ||
        l.ig_handle?.toLowerCase().includes(s) ||
        l.phone?.toLowerCase().includes(s) ||
        l.closer?.toLowerCase().includes(s) ||
        l.setter?.toLowerCase().includes(s) ||
        l.status?.toLowerCase().includes(s) ||
        l.origin?.toLowerCase().includes(s)
      )
    }

    // Advanced filters
    for (const f of filters) {
      result = result.filter(l => {
        const val = String((l as Record<string, unknown>)[f.field] || '')
        switch (f.operator) {
          case 'contains': return val.toLowerCase().includes(f.value.toLowerCase())
          case 'equals': return val.toLowerCase() === f.value.toLowerCase()
          case 'gt': return Number(val) > Number(f.value)
          case 'lt': return Number(val) < Number(f.value)
          case 'empty': return !val || val === '0'
          case 'not_empty': return !!val && val !== '0'
          default: return true
        }
      })
    }

    // Sort
    result.sort((a, b) => {
      const av = (a as Record<string, unknown>)[sort.field]
      const bv = (b as Record<string, unknown>)[sort.field]
      if (typeof av === 'number' && typeof bv === 'number') {
        return sort.dir === 'asc' ? av - bv : bv - av
      }
      const cmp = String(av || '').localeCompare(String(bv || ''))
      return sort.dir === 'asc' ? cmp : -cmp
    })

    return result
  }, [leads, statusTab, search, filters, sort])

  // ── Grouping ──
  const grouped = useMemo(() => {
    if (!groupBy) return null
    const groups: Record<string, Lead[]> = {}
    for (const lead of filtered) {
      const key = String((lead as Record<string, unknown>)[groupBy] || 'Sin valor')
      if (!groups[key]) groups[key] = []
      groups[key].push(lead)
    }
    return groups
  }, [filtered, groupBy])

  // ── Stats (lista visible: respeta pestañas de estado, búsqueda y filtros) ──
  const totalPayment = useMemo(
    () => filtered.reduce((s, l) => s + (Number(l.payment) || 0), 0),
    [filtered],
  )
  const totalOwed = useMemo(
    () => filtered.reduce((s, l) => s + (Number(l.owed) || 0), 0),
    [filtered],
  )

  const toggleSort = (field: string) => {
    if (sort.field === field) setSort({ field, dir: sort.dir === 'asc' ? 'desc' : 'asc' })
    else setSort({ field, dir: 'desc' })
  }

  const toggleSelectAll = () => {
    if (selectedRows.size === filtered.length) setSelectedRows(new Set())
    else setSelectedRows(new Set(filtered.map(l => l.id)))
  }

  const toggleSelectRow = (id: string) => {
    setSelectedRows(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const activeColumns = useMemo(
    () => COLUMNS.filter((c) => visibleColumns.has(c.key)),
    [COLUMNS, visibleColumns],
  )

  const tableColumns = activeColumns

  const resolveAgendaBadgeLabel = useCallback(
    (raw: string | null | undefined) => formatAgendaPointBadgeText(raw, agendaLookups),
    [agendaLookups],
  )

  if (!ready) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>

  const readOnlyGrid = false

  return (
    <div className="flex flex-col h-full">
      {/* ━━ TOOLBAR ━━ */}
      <div className="flex items-center justify-between mb-3">
        {/* Left: Status tabs */}
        <div className="flex items-center gap-1">
          {STATUS_TABS.map(t => (
            <button key={t} onClick={() => setStatusTab(t)}
              className={`px-3 py-1.5 text-[11px] font-medium rounded-full transition-all ${
                statusTab === t
                  ? 'bg-[var(--accent)] text-white font-semibold shadow-[0_0_12px_rgba(230,57,70,0.3)]'
                  : 'text-[var(--text3)] hover:text-[var(--text2)] hover:bg-[rgba(255,255,255,0.04)]'
              }`}>
              {t}
            </button>
          ))}
        </div>

        {/* Right: Metrics */}
        <div className="flex items-center gap-5 text-[12px]">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-[var(--text3)]">Leads</span>
            <span className="font-mono-num font-semibold">{filtered.length}</span>
            {filtered.length !== leads.length && (
              <span className="text-[10px] text-[var(--text3)] font-mono-num">/ {leads.length}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-[var(--text3)]">Cobrado</span>
            <span className="font-mono-num font-semibold text-[var(--green)]">{formatCash(totalPayment)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-[var(--text3)]">Debe</span>
            <span className="font-mono-num font-semibold text-[var(--amber)]">{formatCash(totalOwed)}</span>
          </div>
        </div>
      </div>

      {/* ━━ SECONDARY TOOLBAR ━━ */}
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="flex items-center gap-2">
          {/* Filter button */}
          <ToolbarDropdown
            label="Filtrar" icon="⊕"
            open={showFilterPanel}
            onToggle={() => { setShowFilterPanel(!showFilterPanel); setShowSortPanel(false); setShowColumnPanel(false); setShowGroupPanel(false) }}>
            <FilterPanel filters={filters} setFilters={setFilters} columns={COLUMNS} />
          </ToolbarDropdown>

          {/* Sort button */}
          <ToolbarDropdown
            label="Ordenar" icon="↕"
            open={showSortPanel}
            onToggle={() => { setShowSortPanel(!showSortPanel); setShowFilterPanel(false); setShowColumnPanel(false); setShowGroupPanel(false) }}>
            <SortPanel sort={sort} setSort={setSort} columns={COLUMNS} />
          </ToolbarDropdown>

          {/* Columns button */}
          <ToolbarDropdown
            label="Columnas" icon="⊞"
            open={showColumnPanel}
            onToggle={() => { setShowColumnPanel(!showColumnPanel); setShowFilterPanel(false); setShowSortPanel(false); setShowGroupPanel(false) }}>
            <ColumnPanel columns={COLUMNS} visible={visibleColumns} setVisible={setVisibleColumns} />
          </ToolbarDropdown>

          {/* Group button */}
          <ToolbarDropdown
            label="Agrupar" icon="≡"
            open={showGroupPanel}
            onToggle={() => { setShowGroupPanel(!showGroupPanel); setShowFilterPanel(false); setShowSortPanel(false); setShowColumnPanel(false) }}>
            <GroupPanel groupBy={groupBy} setGroupBy={setGroupBy} columns={COLUMNS} />
          </ToolbarDropdown>

          {/* Bulk actions */}
          {selectedRows.size > 0 && !readOnlyGrid && (
            <div className="flex items-center gap-2 ml-2 pl-2 border-l border-[var(--border2)]">
              <span className="text-[11px] text-[var(--text3)]">{selectedRows.size} sel.</span>
              <button
                type="button"
                onClick={() => setDeleteConfirmIds(Array.from(selectedRows))}
                className="px-2 py-1 text-[11px] text-[#F87171] hover:bg-[rgba(248,113,113,0.1)] rounded transition-colors"
              >
                Eliminar
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text3)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text" placeholder="Buscar..." value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] pl-8 pr-3 py-1.5 text-[12px] text-[var(--text)] outline-none w-48 focus:border-[var(--text3)] transition-colors"
            />
          </div>

          <MonthSelector month={month} options={options} onChange={setMonth} />
        </div>
      </div>

      {/* ━━ TABLE ━━ */}
      {loading ? (
        <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>
      ) : grouped ? (
        <div className="flex-1 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg2)]">
          {Object.entries(grouped).map(([groupName, groupLeads]) => (
            <div key={groupName}>
              <div className="sticky top-0 z-10 bg-[var(--bg3)] px-4 py-2 border-b border-[var(--border)] flex items-center gap-2">
                <span className="text-[11px] font-semibold text-[var(--text)]">{groupName}</span>
                <span className="text-[10px] text-[var(--text3)] font-mono-num">{groupLeads.length}</span>
              </div>
              <LeadsTable
                leads={groupLeads} columns={tableColumns} sort={sort}
                editingCell={editingCell} setEditingCell={setEditingCell}
                onInlineUpdate={handleInlineUpdate} onToggleSort={toggleSort}
                selectedRows={selectedRows} onToggleRow={toggleSelectRow}
                onToggleAll={toggleSelectAll} allSelected={selectedRows.size === filtered.length}
                onDelete={(id) => setDeleteConfirmIds([id])}
                onAddRow={handleAddRow}
                addingRow={addingRow}
                totalLeads={filtered.length}
                onPreviewText={(title, text) => setTextPreview({ title, text })}
                readOnly={readOnlyGrid}
                resolveAgendaBadgeLabel={resolveAgendaBadgeLabel}
                onOpenAgendaPicker={(lead) => {
                  setFunnelModalLead(null)
                  setAgendaModalLead(lead)
                }}
                onOpenFunnelPicker={(lead) => {
                  setAgendaModalLead(null)
                  setFunnelModalLead(lead)
                }}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg2)]">
          <LeadsTable
            leads={filtered} columns={tableColumns} sort={sort}
            editingCell={editingCell} setEditingCell={setEditingCell}
            onInlineUpdate={handleInlineUpdate} onToggleSort={toggleSort}
            selectedRows={selectedRows} onToggleRow={toggleSelectRow}
            onToggleAll={toggleSelectAll} allSelected={selectedRows.size === filtered.length && filtered.length > 0}
            onDelete={(id) => setDeleteConfirmIds([id])}
            onAddRow={handleAddRow}
            addingRow={addingRow}
            totalLeads={filtered.length}
            onPreviewText={(title, text) => setTextPreview({ title, text })}
            readOnly={readOnlyGrid}
            resolveAgendaBadgeLabel={resolveAgendaBadgeLabel}
            onOpenAgendaPicker={(lead) => {
              setFunnelModalLead(null)
              setAgendaModalLead(lead)
            }}
            onOpenFunnelPicker={(lead) => {
              setAgendaModalLead(null)
              setFunnelModalLead(lead)
            }}
          />
        </div>
      )}

      <AgendaPointPickerModal
        open={Boolean(agendaModalLead || funnelModalLead)}
        modalTitle={funnelModalLead ? '1er ingreso embudo' : 'Punto de agenda'}
        onClose={() => {
          setAgendaModalLead(null)
          setFunnelModalLead(null)
        }}
        hasAssignedPuntoAgenda={
          funnelModalLead
            ? Boolean(funnelModalLead.entry_channel?.trim())
            : Boolean(agendaModalLead?.agenda_point?.trim())
        }
        onSavePuntoAgenda={async (value) => {
          const funnel = funnelModalLead
          const agenda = agendaModalLead
          if (funnel) {
            await handleInlineUpdate(funnel.id, 'entry_channel', value)
            return
          }
          if (agenda) {
            await handleInlineUpdate(agenda.id, 'agenda_point', value)
          }
        }}
        onCacheReel={(id, meta) =>
          setAgendaLookups((prev) => ({
            ...prev,
            reels: { ...prev.reels, [id]: meta },
          }))
        }
        onCacheSequence={(id, meta) =>
          setAgendaLookups((prev) => ({
            ...prev,
            sequences: { ...prev.sequences, [id]: meta },
          }))
        }
        onCacheYoutube={(id, meta) =>
          setAgendaLookups((prev) => ({
            ...prev,
            youtube: {
              ...prev.youtube,
              [id]: meta,
              [`youtube:${id}`]: meta,
            },
          }))
        }
      />

      {/* ━━ MODAL confirmar eliminación ━━ */}
      {deleteConfirmIds && deleteConfirmIds.length > 0 && (
        <Modal
          open
          onClose={() => !deleteBusy && setDeleteConfirmIds(null)}
          title="Eliminar"
          maxWidth="420px"
        >
          <p className="text-[13px] leading-relaxed text-[var(--text2)]">
            {deleteConfirmIds.length === 1 ? (
              <>
                ¿Eliminar a{' '}
                <span className="font-medium text-[var(--text)]">
                  {(() => {
                    const row = leads.find((l) => l.id === deleteConfirmIds[0])
                    const label = [row?.client_name, row?.ig_handle].filter(Boolean).join(' · ')
                    return label || 'este cliente'
                  })()}
                </span>
                ? No se puede deshacer.
              </>
            ) : (
              <>
                ¿Eliminar <span className="font-mono-num font-medium text-[var(--text)]">{deleteConfirmIds.length}</span>{' '}
                clientes seleccionados? No se puede deshacer.
              </>
            )}
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              disabled={deleteBusy}
              onClick={() => setDeleteConfirmIds(null)}
              className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-2 text-[11px] font-semibold uppercase text-[var(--text2)] transition-colors hover:border-[var(--text3)] disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={deleteBusy}
              onClick={async () => {
                const ids = [...deleteConfirmIds]
                await executeDelete(ids)
                setDeleteConfirmIds(null)
              }}
              className="rounded-lg bg-[#F87171] px-4 py-2 text-[11px] font-semibold uppercase text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {deleteBusy ? 'Eliminando…' : 'Eliminar'}
            </button>
          </div>
        </Modal>
      )}

      {/* ━━ MODAL (text preview) ━━ */}
      {textPreview && (
        <Modal open={!!textPreview} onClose={() => setTextPreview(null)} title={textPreview.title} maxWidth="750px">
          <div className="max-h-[70vh] overflow-y-auto pr-2 space-y-1">
            {textPreview.text.replace(/\\n/g, '\n').split('\n').map((line, i) => {
              const trimmed = line.trim()
              if (!trimmed) return <div key={i} className="h-2" />
              const isBullet = trimmed.startsWith('•') || trimmed.startsWith('–') || trimmed.startsWith('-')
              const isHeader = trimmed.endsWith(':') || trimmed.includes('?:') || trimmed.startsWith('📋') || trimmed.startsWith('FICHA')
              const isSubValue = !isBullet && !isHeader && i > 0
              if (isHeader) return (
                <p key={i} className="text-[13px] font-semibold text-[var(--text)] mt-4 mb-1 border-b border-[var(--border)] pb-1">{trimmed}</p>
              )
              if (isBullet) return (
                <p key={i} className="text-[13px] leading-relaxed text-[var(--text2)] pl-3">{trimmed}</p>
              )
              return (
                <p key={i} className={`text-[13px] leading-relaxed ${isSubValue ? 'text-[var(--text2)]' : 'text-[var(--text)]'}`}>{trimmed}</p>
              )
            })}
          </div>
        </Modal>
      )}
    </div>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LEADS TABLE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Anchos checkbox y # (variables CSS `--leads-check-w` / `--leads-num-w` deben coincidir). */
const LEADS_TABLE_CHECK_W = 48
const LEADS_TABLE_NUM_W = 40

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function LeadsTable({
  leads,
  columns,
  sort,
  editingCell,
  setEditingCell,
  onInlineUpdate,
  onToggleSort,
  selectedRows,
  onToggleRow,
  onToggleAll,
  allSelected,
  onDelete,
  onAddRow,
  addingRow,
  totalLeads,
  onPreviewText,
  readOnly,
  resolveAgendaBadgeLabel,
  onOpenAgendaPicker,
  onOpenFunnelPicker,
}: {
  leads: Lead[]
  columns: ColumnDef[]
  sort: SortConfig
  editingCell: { id: string; field: string } | null
  setEditingCell: (v: { id: string; field: string } | null) => void
  onInlineUpdate: (id: string, field: string, value: string | number | null) => void
  onToggleSort: (field: string) => void
  selectedRows: Set<string>
  onToggleRow: (id: string) => void
  onToggleAll: () => void
  allSelected: boolean
  onDelete: (id: string) => void
  onAddRow: () => void
  addingRow: boolean
  totalLeads: number
  onPreviewText: (title: string, text: string) => void
  readOnly?: boolean
  resolveAgendaBadgeLabel: (raw: string | null | undefined) => string
  onOpenAgendaPicker: (lead: Lead) => void
  onOpenFunnelPicker: (lead: Lead) => void
}) {
  const stickyName = columns.some((c) => c.key === 'client_name' && c.sticky)

  return (
    <table
      className="leads-table w-full"
      style={{
        minWidth: columns.reduce((s, c) => s + c.width, 100),
        ['--leads-check-w' as string]: `${LEADS_TABLE_CHECK_W}px`,
        ['--leads-num-w' as string]: `${LEADS_TABLE_NUM_W}px`,
      }}
    >
      <thead className="sticky top-0 z-20">
        <tr className="bg-[var(--bg3)]">
          {/* Checkbox */}
          <th
            className={`border-b border-[var(--border2)] px-2 py-2 text-center ${
              stickyName ? 'leads-table__sticky-frozen leads-table__sticky-check' : ''
            }`}
            style={{ width: LEADS_TABLE_CHECK_W, minWidth: LEADS_TABLE_CHECK_W, maxWidth: LEADS_TABLE_CHECK_W }}
          >
            <input type="checkbox" checked={allSelected} onChange={onToggleAll} disabled={readOnly}
              className="w-3.5 h-3.5 rounded border-[var(--border2)] bg-transparent accent-[var(--accent)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" />
          </th>
          {/* Row number */}
          <th
            className={`border-b border-[var(--border2)] px-1 py-2 text-center text-[10px] font-medium text-[var(--text3)] ${
              stickyName ? 'leads-table__sticky-frozen leads-table__sticky-num' : ''
            }`}
            style={{ width: LEADS_TABLE_NUM_W, minWidth: LEADS_TABLE_NUM_W, maxWidth: LEADS_TABLE_NUM_W }}
          >
            #
          </th>
          {/* Columns */}
          {columns.map(col => (
            <th key={col.key}
              onClick={() => onToggleSort(col.key)}
              className={`border-b border-[var(--border2)] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)] hover:text-[var(--text2)] cursor-pointer select-none whitespace-nowrap transition-colors ${
                stickyName && col.key === 'client_name'
                  ? 'leads-table__sticky-frozen leads-table__sticky-name'
                  : ''
              }`}
              style={{ width: col.width, minWidth: col.width }}>
              <div className="flex items-center gap-1 min-w-0">
                <span className="truncate">{col.label}</span>
                {sort.field === col.key && (
                  <span className="text-[var(--accent)] text-[9px] shrink-0">{sort.dir === 'asc' ? '↑' : '↓'}</span>
                )}
              </div>
            </th>
          ))}
          {/* Actions */}
          <th className="w-10 border-b border-[var(--border2)]" />
        </tr>
      </thead>
      <tbody>
        {leads.map((lead, idx) => {
          const rowSel = selectedRows.has(lead.id)
          return (
          <tr key={lead.id}
            className={`group transition-colors ${
              rowSel ? 'leads-table__row--selected bg-[rgba(230,57,70,0.06)]' : 'hover:bg-[rgba(255,255,255,0.02)]'
            }`}>
            {/* Checkbox */}
            <td
              className={`border-b border-[var(--border)] px-2 py-1.5 text-center ${
                stickyName ? 'leads-table__sticky-frozen leads-table__sticky-check' : ''
              }`}
              style={{ width: LEADS_TABLE_CHECK_W, minWidth: LEADS_TABLE_CHECK_W, maxWidth: LEADS_TABLE_CHECK_W }}
            >
              <input type="checkbox" checked={selectedRows.has(lead.id)} onChange={() => onToggleRow(lead.id)} disabled={readOnly}
                className="w-3.5 h-3.5 rounded border-[var(--border2)] bg-transparent accent-[var(--accent)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" />
            </td>
            {/* Row number */}
            <td
              className={`border-b border-[var(--border)] px-1 py-1.5 text-center text-[11px] font-mono-num text-[var(--text3)] ${
                stickyName ? 'leads-table__sticky-frozen leads-table__sticky-num' : ''
              }`}
              style={{ width: LEADS_TABLE_NUM_W, minWidth: LEADS_TABLE_NUM_W, maxWidth: LEADS_TABLE_NUM_W }}
            >
              {idx + 1}
            </td>
            {/* Cells */}
            {columns.map(col => (
              <td
                key={col.key}
                className={`border-b border-[var(--border)] px-3 py-1.5 ${
                  stickyName && col.key === 'client_name'
                    ? 'leads-table__sticky-frozen leads-table__sticky-name'
                    : ''
                }`}
                style={{ width: col.width, minWidth: col.width }}
              >
                <LeadsTableCell
                  lead={lead}
                  col={col}
                  editing={editingCell?.id === lead.id && editingCell?.field === col.key}
                  onStartEdit={() => {
                    if (col.editable === false) return
                    setEditingCell({ id: lead.id, field: col.key })
                  }}
                  onCancelEdit={() => setEditingCell(null)}
                  onSave={(value) => onInlineUpdate(lead.id, col.key, value)}
                  onPreviewText={onPreviewText}
                  readOnly={readOnly}
                  resolveAgendaBadgeLabel={resolveAgendaBadgeLabel}
                  onOpenAgendaPicker={onOpenAgendaPicker}
                  onOpenFunnelPicker={onOpenFunnelPicker}
                />
              </td>
            ))}
            {/* Delete */}
            <td className="border-b border-[var(--border)] px-2 py-1.5 text-center">
              {!readOnly && (
                <button onClick={() => onDelete(lead.id)}
                  className="opacity-0 group-hover:opacity-100 text-[var(--text3)] hover:text-[#F87171] transition-all text-sm">
                  ×
                </button>
              )}
            </td>
          </tr>
          )
        })}
        {/* Empty next-row number hint */}
        <tr>
          <td className="border-b border-[var(--border)] px-2 py-1.5" />
          <td className="border-b border-[var(--border)] px-1 py-1.5 text-center text-[11px] font-mono-num text-[var(--text3)] opacity-40">{totalLeads + 1}</td>
          <td className="border-b border-[var(--border)]" colSpan={columns.length + 1} />
        </tr>
        {/* + Nuevo lead row */}
        {!readOnly && (
          <tr className="cursor-pointer bg-[var(--bg)] transition-colors hover:bg-[rgba(255,255,255,0.02)]"
            onClick={onAddRow}>
            <td colSpan={columns.length + 3} className="border-b border-[var(--border)] px-3 py-2">
              <span className="text-[12px] text-[var(--text3)] hover:text-[var(--text2)] transition-colors">
                {addingRow ? 'Creando...' : '+ Nuevo lead'}
              </span>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LEAD TABLE CELL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function LeadsTableCell({
  lead,
  col,
  editing,
  onStartEdit,
  onCancelEdit,
  onSave,
  onPreviewText,
  readOnly,
  resolveAgendaBadgeLabel,
  onOpenAgendaPicker,
  onOpenFunnelPicker,
}: {
  lead: Lead
  col: ColumnDef
  editing: boolean
  onStartEdit: () => void
  onCancelEdit: () => void
  onSave: (value: string | number | null) => void
  onPreviewText: (title: string, text: string) => void
  readOnly?: boolean
  resolveAgendaBadgeLabel: (raw: string | null | undefined) => string
  onOpenAgendaPicker: (lead: Lead) => void
  onOpenFunnelPicker: (lead: Lead) => void
}) {
  const raw = (lead as Record<string, unknown>)[col.key]
  const value =
    col.key === 'origin'
      ? originDisplayValue(lead)
      : col.key === 'agendo_en'
        ? agendoEnStoredValue(lead)
        : col.key === 'email'
          ? calendlyEmailFromNotes(lead.notes)
          : raw

  if (readOnly) {
    if (col.key === 'client_name') {
      return (
        <span className="text-[13px] font-medium truncate block text-[var(--text)]">
          {String(value || '—')}
        </span>
      )
    }
    if (col.key === 'agenda_point') {
      const rawAp = String(lead.agenda_point || '').trim()
      if (!rawAp) return <span className="text-[12px] text-[var(--text3)]">—</span>
      const label = resolveAgendaBadgeLabel(lead.agenda_point)
      const color = '#6B7280'
      return (
        <span
          title={rawAp}
          className="inline-flex max-w-full items-center truncate rounded-full px-2.5 py-0.5 text-[11px] font-medium"
          style={{ backgroundColor: color + '18', color, border: `1px solid ${color}30` }}
        >
          {label}
        </span>
      )
    }
    if (col.key === 'entry_channel') {
      const rawEc = String(lead.entry_channel || '').trim()
      if (!rawEc) return <span className="text-[12px] text-[var(--text3)]">—</span>
      const label = resolveAgendaBadgeLabel(lead.entry_channel)
      const color = '#6B7280'
      return (
        <span
          title={rawEc}
          className="inline-flex max-w-full items-center truncate rounded-full px-2.5 py-0.5 text-[11px] font-medium"
          style={{ backgroundColor: color + '18', color, border: `1px solid ${color}30` }}
        >
          {label}
        </span>
      )
    }
    if (col.type === 'badge' && value) {
      const color = col.colors?.[String(value)] || '#6B7280'
      return (
        <span
          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium truncate max-w-full"
          style={{ backgroundColor: color + '18', color, border: `1px solid ${color}30` }}>
          {String(value)}
        </span>
      )
    }
    if (col.type === 'badge' && !value) {
      return <span className="text-[12px] text-[var(--text3)]">—</span>
    }
    if (col.type === 'select') {
      const color = col.colors?.[String(value)] || '#888'
      const selectLabel =
        col.key === 'agendo_en' ? formatAgendoEnForDisplay(String(value || '')) : String(value || '—')
      return (
        <span
          className="inline-flex h-6 max-w-full items-center justify-center rounded-full px-2.5 text-[11px] font-semibold leading-none"
          style={{ backgroundColor: color + '20', color }}>
          {selectLabel}
        </span>
      )
    }
    if (col.type === 'currency') {
      const num = Number(value) || 0
      const isOwed = col.key === 'owed'
      const isPay = col.key === 'payment'
      return (
        <span className={`font-mono-num text-[12px] ${
          isOwed && num > 0 ? 'text-[var(--amber)]' :
          isPay && num > 0 ? 'text-[var(--green)]' :
          num === 0 ? 'text-[var(--text3)]' : ''
        }`}>
          {num > 0 ? formatCash(num) : isOwed ? '—' : '$0'}
        </span>
      )
    }
    if (col.type === 'link') {
      if (!value) return <span className="text-[12px] text-[var(--text3)]">—</span>
      return (
        <a href={String(value)} target="_blank" rel="noopener noreferrer"
          className="text-[12px] text-[var(--accent)] hover:underline inline-flex items-center gap-1">
          ↗ Link
        </a>
      )
    }
    if (col.type === 'date') {
      if (!value) return <span className="text-[12px] text-[var(--text3)]">—</span>
      const shown = formatIsoDateToDdMmYyyy(String(value)) ?? String(value)
      return <span className="text-[12px] font-mono-num text-[var(--text2)]">{shown}</span>
    }
    if (col.type === 'number') {
      return (
        <span className="text-[12px] font-mono-num text-[var(--text2)]">
          {value != null ? String(value) : '—'}
        </span>
      )
    }
    const reportKeys = ['closer_report', 'dolores_llamada', 'razon_compra']
    if (reportKeys.includes(col.key) && value) {
      const text = String(value)
      const preview = text.length > 50 ? `${text.substring(0, 50)}...` : text
      const labelMap: Record<string, string> = {
        closer_report: 'Reporte Closer', dolores_llamada: 'Dolores de la Llamada', razon_compra: 'Razón de Compra',
      }
      return (
        <span onClick={() => onPreviewText(labelMap[col.key] || col.key, text)} className="text-[12px] text-[var(--text2)] cursor-pointer hover:text-[var(--accent)] truncate block">
          {preview}
        </span>
      )
    }
    const longTextKeys = ['dolores_setting', 'notes']
    if (longTextKeys.includes(col.key) && value) {
      const text = String(value)
      const preview = text.length > 60 ? `${text.substring(0, 60)}...` : text
      return (
        <span onClick={() => onPreviewText(col.label, text)} className="text-[12px] text-[var(--text2)] cursor-pointer truncate block" title={text}>
          {preview}
        </span>
      )
    }
    return (
      <span className={`text-[12px] truncate block max-w-full ${!value ? 'text-[var(--text3)]' : 'text-[var(--text2)]'}`}>
        {value ? String(value) : '—'}
      </span>
    )
  }

  // ── Editing mode ──
  if (editing && col.editable) {
    if (col.type === 'select' || (col.type === 'badge' && col.options)) {
      const opts =
        col.key === 'origin'
          ? originSelectOptions(lead)
          : col.key === 'agendo_en'
            ? agendoEnSelectOptions(lead)
            : col.key === 'setter' || col.key === 'closer'
              ? teamRoleSelectOptions(lead, col.key, col.options!)
              : col.key === 'program_offered'
                ? programOfferedSelectOptions(lead, col.options!)
                : col.options!
      return (
        <select
          autoFocus
          defaultValue={String(
            col.key === 'origin' || col.key === 'agendo_en' ? value : (value ?? ''),
          )}
          onChange={(e) => onSave(e.target.value || null)}
          className="w-full rounded border border-[var(--accent)] bg-[var(--bg3)] px-2 py-1 text-[12px] text-[var(--text)] outline-none"
        >
          {opts.map((o) => (
            <option key={o} value={o}>
              {col.key === 'agendo_en' ? formatAgendoEnForDisplay(o) : o === '' ? '—' : o}
            </option>
          ))}
        </select>
      )
    }
    return (
      <input
        autoFocus
        type={col.type === 'number' || col.type === 'currency' ? 'number' : col.type === 'date' ? 'date' : 'text'}
        defaultValue={col.type === 'date' ? toHtmlDateInputValue(String(value ?? '')) : String(value ?? '')}
        onBlur={(e) => {
          const v = e.target.value
          if (col.type === 'number' || col.type === 'currency') onSave(Number(v) || 0)
          else onSave(v || null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') onCancelEdit()
        }}
        className="w-full rounded border border-[var(--accent)] bg-[var(--bg3)] px-2 py-1 text-[12px] text-[var(--text)] outline-none"
      />
    )
  }

  // ── Display mode ──
  const cellClass = "text-[12px] cursor-pointer hover:opacity-80 truncate block max-w-full"

  if (col.key === 'agenda_point' && !readOnly) {
    const rawAp = String(lead.agenda_point || '').trim()
    const label = rawAp ? resolveAgendaBadgeLabel(lead.agenda_point) : ''
    const color = '#6B7280'
    return (
      <span
        role="button"
        tabIndex={0}
        title={rawAp || undefined}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpenAgendaPicker(lead)
          }
        }}
        onClick={() => onOpenAgendaPicker(lead)}
        className="inline-flex max-w-full cursor-pointer items-center truncate rounded-full px-2.5 py-0.5 text-[11px] font-medium hover:opacity-90"
        style={{ backgroundColor: color + '18', color, border: `1px solid ${color}30` }}
      >
        {label || '—'}
      </span>
    )
  }

  if (col.key === 'entry_channel' && !readOnly) {
    const rawEc = String(lead.entry_channel || '').trim()
    const label = rawEc ? resolveAgendaBadgeLabel(lead.entry_channel) : ''
    const color = '#6B7280'
    return (
      <span
        role="button"
        tabIndex={0}
        title={rawEc || undefined}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpenFunnelPicker(lead)
          }
        }}
        onClick={() => onOpenFunnelPicker(lead)}
        className="inline-flex max-w-full cursor-pointer items-center truncate rounded-full px-2.5 py-0.5 text-[11px] font-medium hover:opacity-90"
        style={{ backgroundColor: color + '18', color, border: `1px solid ${color}30` }}
      >
        {label || '—'}
      </span>
    )
  }

  // Name column
  if (col.key === 'client_name') {
    return (
      <span
        onClick={onStartEdit}
        className="text-[13px] font-medium cursor-pointer hover:text-[var(--accent)] transition-colors truncate block"
      >
        {String(value || '—')}
      </span>
    )
  }

  // Badge type (avatar, program, origin, channel)
  if (col.type === 'badge' && value) {
    const color = col.colors?.[String(value)] || '#6B7280'
    return (
      <span onClick={onStartEdit}
        className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium cursor-pointer truncate max-w-full"
        style={{ backgroundColor: color + '18', color, border: `1px solid ${color}30` }}>
        {String(value)}
      </span>
    )
  }
  if (col.type === 'badge' && !value) {
    return <span onClick={onStartEdit} className={`${cellClass} text-[var(--text3)]`}>—</span>
  }

  // Select (status, origin, …)
  if (col.type === 'select') {
    const opts =
      col.key === 'origin'
        ? originSelectOptions(lead)
        : col.key === 'agendo_en'
          ? agendoEnSelectOptions(lead)
          : col.options!
    const color = col.colors?.[String(value)] || '#888'
    return (
      <span
        className="inline-flex h-6 max-w-full min-w-0 items-center overflow-hidden rounded-full px-2.5"
        style={{ backgroundColor: color + '20' }}>
        <select
          value={String(col.key === 'origin' || col.key === 'agendo_en' ? value : (value || ''))}
          onChange={(e) => onSave(e.target.value)}
          className="box-border h-full min-h-0 w-full min-w-0 cursor-pointer appearance-none border-0 bg-transparent p-0 text-[11px] font-semibold leading-none outline-none"
          style={{ color }}>
          {opts.map((s) => (
            <option key={s} value={s}>
              {col.key === 'agendo_en' ? formatAgendoEnForDisplay(s) : s}
            </option>
          ))}
        </select>
      </span>
    )
  }

  // Currency
  if (col.type === 'currency') {
    const num = Number(value) || 0
    const isOwed = col.key === 'owed'
    const isPay = col.key === 'payment'
    return (
      <span onClick={onStartEdit}
        className={`font-mono-num text-[12px] cursor-pointer hover:opacity-80 ${
          isOwed && num > 0 ? 'text-[var(--amber)]' :
          isPay && num > 0 ? 'text-[var(--green)]' :
          num === 0 ? 'text-[var(--text3)]' : ''
        }`}>
        {num > 0 ? formatCash(num) : isOwed ? '—' : '$0'}
      </span>
    )
  }

  // Link
  if (col.type === 'link') {
    if (!value) return <span onClick={onStartEdit} className={`${cellClass} text-[var(--text3)]`}>—</span>
    return (
      <a href={String(value)} target="_blank" rel="noopener noreferrer"
        className="text-[12px] text-[var(--accent)] hover:underline inline-flex items-center gap-1">
        ↗ Link
      </a>
    )
  }

  // Date
  if (col.type === 'date') {
    if (!value) return <span onClick={onStartEdit} className={`${cellClass} text-[var(--text3)]`}>—</span>
    const dateStr = formatIsoDateToDdMmYyyy(String(value)) ?? String(value)
    return (
      <span onClick={onStartEdit} className={`${cellClass} font-mono-num text-[var(--text2)]`}>
        {dateStr}
      </span>
    )
  }

  // Number
  if (col.type === 'number') {
    return (
      <span onClick={onStartEdit} className={`${cellClass} font-mono-num ${!value && value !== 0 ? 'text-[var(--text3)]' : ''}`}>
        {value != null ? String(value) : '—'}
      </span>
    )
  }

  // Fathom report fields — click to open formatted preview modal
  const reportKeys = ['closer_report', 'dolores_llamada', 'razon_compra']
  if (reportKeys.includes(col.key) && value) {
    const text = String(value)
    const preview = text.length > 50 ? text.substring(0, 50) + '...' : text
    const labelMap: Record<string, string> = {
      closer_report: 'Reporte Closer', dolores_llamada: 'Dolores de la Llamada',
      razon_compra: 'Razón de Compra',
    }
    return (
      <span
        onClick={() => onPreviewText(labelMap[col.key] || col.key, text)}
        className={`${cellClass} text-[var(--text2)] cursor-pointer hover:text-[var(--accent)] transition-colors`}
      >
        {preview}
      </span>
    )
  }

  // Other long text fields — normal truncated display
  const longTextKeys = ['dolores_setting', 'notes']
  if (longTextKeys.includes(col.key) && value) {
    const text = String(value)
    const preview = text.length > 60 ? text.substring(0, 60) + '...' : text
    return (
      <span onClick={onStartEdit} className={`${cellClass} text-[var(--text2)] cursor-pointer`} title={text}>
        {preview}
      </span>
    )
  }

  // Default text
  return (
    <span onClick={onStartEdit} className={`${cellClass} ${!value ? 'text-[var(--text3)]' : 'text-[var(--text2)]'}`}>
      {value ? String(value) : '—'}
    </span>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TOOLBAR DROPDOWN WRAPPER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function ToolbarDropdown({ label, icon, open, onToggle, children }: {
  label: string; icon: string; open: boolean; onToggle: () => void; children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onToggle()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onToggle])

  return (
    <div className="relative" ref={ref}>
      <button onClick={onToggle}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] rounded-md transition-all ${
          open ? 'bg-[var(--bg4)] text-[var(--text)]' : 'text-[var(--text3)] hover:text-[var(--text2)] hover:bg-[rgba(255,255,255,0.04)]'
        }`}>
        <span className="text-[10px]">{icon}</span>
        {label}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-30 min-w-[240px] rounded-lg border border-[var(--border2)] bg-[var(--bg2)] shadow-lg p-3 backdrop-blur-xl">
          {children}
        </div>
      )}
    </div>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FILTER PANEL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function FilterPanel({ filters, setFilters, columns }: {
  filters: FilterConfig[]; setFilters: (f: FilterConfig[]) => void; columns: ColumnDef[]
}) {
  const addFilter = () => {
    setFilters([...filters, { field: 'client_name', operator: 'contains', value: '' }])
  }
  const updateFilter = (idx: number, patch: Partial<FilterConfig>) => {
    setFilters(filters.map((f, i) => i === idx ? { ...f, ...patch } : f))
  }
  const removeFilter = (idx: number) => {
    setFilters(filters.filter((_, i) => i !== idx))
  }

  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text3)] font-semibold mb-2">Filtros</div>
      {filters.map((f, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <select value={f.field} onChange={e => updateFilter(i, { field: e.target.value })}
            className="flex-1 rounded border border-[var(--border2)] bg-[var(--bg3)] px-2 py-1 text-[11px] text-[var(--text)] outline-none">
            {columns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <select value={f.operator} onChange={e => updateFilter(i, { operator: e.target.value as FilterConfig['operator'] })}
            className="rounded border border-[var(--border2)] bg-[var(--bg3)] px-2 py-1 text-[11px] text-[var(--text)] outline-none">
            <option value="contains">contiene</option>
            <option value="equals">es igual</option>
            <option value="gt">mayor que</option>
            <option value="lt">menor que</option>
            <option value="empty">vacío</option>
            <option value="not_empty">no vacío</option>
          </select>
          {f.operator !== 'empty' && f.operator !== 'not_empty' && (
            <input value={f.value} onChange={e => updateFilter(i, { value: e.target.value })}
              placeholder="valor..."
              className="w-20 rounded border border-[var(--border2)] bg-[var(--bg3)] px-2 py-1 text-[11px] text-[var(--text)] outline-none" />
          )}
          <button onClick={() => removeFilter(i)} className="text-[var(--text3)] hover:text-[#F87171] text-sm">×</button>
        </div>
      ))}
      <button onClick={addFilter}
        className="text-[11px] text-[var(--accent)] hover:underline">
        + Agregar filtro
      </button>
    </div>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SORT PANEL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function SortPanel({ sort, setSort, columns }: {
  sort: SortConfig; setSort: (s: SortConfig) => void; columns: ColumnDef[]
}) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text3)] font-semibold mb-2">Ordenar por</div>
      <select value={sort.field} onChange={e => setSort({ ...sort, field: e.target.value })}
        className="w-full rounded border border-[var(--border2)] bg-[var(--bg3)] px-2 py-1.5 text-[11px] text-[var(--text)] outline-none">
        {columns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
      </select>
      <div className="flex gap-2">
        <button onClick={() => setSort({ ...sort, dir: 'asc' })}
          className={`flex-1 py-1.5 text-[11px] rounded border transition-all ${sort.dir === 'asc' ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-faint)]' : 'border-[var(--border2)] text-[var(--text3)]'}`}>
          Ascendente ↑
        </button>
        <button onClick={() => setSort({ ...sort, dir: 'desc' })}
          className={`flex-1 py-1.5 text-[11px] rounded border transition-all ${sort.dir === 'desc' ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-faint)]' : 'border-[var(--border2)] text-[var(--text3)]'}`}>
          Descendente ↓
        </button>
      </div>
    </div>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COLUMN PANEL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function ColumnPanel({ columns, visible, setVisible }: {
  columns: ColumnDef[]; visible: Set<string>; setVisible: (s: Set<string>) => void
}) {
  const toggle = (key: string) => {
    const next = new Set(visible)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setVisible(next)
  }

  return (
    <div className="space-y-1 max-h-[300px] overflow-y-auto">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text3)] font-semibold mb-2">Columnas visibles</div>
      {columns.map(col => (
        <label key={col.key} className="flex items-center gap-2 py-1 cursor-pointer hover:bg-[rgba(255,255,255,0.03)] rounded px-1 -mx-1">
          <input type="checkbox" checked={visible.has(col.key)} onChange={() => toggle(col.key)}
            className="w-3.5 h-3.5 rounded accent-[var(--accent)]" />
          <span className="text-[11px] text-[var(--text2)]">{col.label}</span>
        </label>
      ))}
      <div className="flex gap-2 pt-2 border-t border-[var(--border)]">
        <button onClick={() => setVisible(new Set(columns.map(c => c.key)))}
          className="text-[10px] text-[var(--accent)] hover:underline">Todas</button>
        <button onClick={() => setVisible(new Set(columns.filter(c => c.defaultVisible).map(c => c.key)))}
          className="text-[10px] text-[var(--text3)] hover:underline">Reset</button>
      </div>
    </div>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GROUP PANEL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function GroupPanel({ groupBy, setGroupBy, columns }: {
  groupBy: string | null; setGroupBy: (g: string | null) => void; columns: ColumnDef[]
}) {
  const groupableFields = columns.filter(c => ['select', 'badge', 'text'].includes(c.type))

  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text3)] font-semibold mb-2">Agrupar por</div>
      <button
        onClick={() => setGroupBy(null)}
        className={`w-full text-left px-2 py-1.5 text-[11px] rounded transition-all ${
          !groupBy ? 'bg-[var(--accent-faint)] text-[var(--accent)] border border-[var(--accent)]' : 'text-[var(--text2)] hover:bg-[rgba(255,255,255,0.03)]'
        }`}>
        Sin agrupar
      </button>
      {groupableFields.map(col => (
        <button key={col.key}
          onClick={() => setGroupBy(col.key)}
          className={`w-full text-left px-2 py-1.5 text-[11px] rounded transition-all ${
            groupBy === col.key ? 'bg-[var(--accent-faint)] text-[var(--accent)] border border-[var(--accent)]' : 'text-[var(--text2)] hover:bg-[rgba(255,255,255,0.03)]'
          }`}>
          {col.label}
        </button>
      ))}
    </div>
  )
}

