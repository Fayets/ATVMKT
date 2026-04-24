'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useMonthContext } from '@/shared/components/app-providers'
import { MonthSelector } from '@/shared/components/month-selector'
import { Modal } from '@/shared/components/modal'
import { useToast } from '@/shared/components/toast'
import { useSupabase } from '@/shared/hooks/use-supabase'
import { formatCash } from '@/shared/lib/supabase/queries'
import {
  Lead, ColumnDef, SortConfig, FilterConfig,
  STATUS_COLORS, AVATAR_COLORS, CHANNEL_COLORS, PROGRAM_COLORS,
  STATUS_OPTIONS, AVATAR_OPTIONS, PROGRAM_OPTIONS, CHANNEL_OPTIONS,
  STATUS_TABS, buildColumns, canonicalLeadStatus,
} from '../types'
import { mapAirtableRecordToLead } from '../services/airtable-leads-mapper'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN PAGE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function LeadsPage() {
  const { month, options, setMonth } = useMonthContext()
  const { toast } = useToast()
  const { supabase, ready, userId } = useSupabase()

  // Data
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [leadsDataSource, setLeadsDataSource] = useState<'supabase' | 'airtable'>('supabase')
  const [airtableMeta, setAirtableMeta] = useState<{
    table_name: string | null
    base_id: string | null
    table_id: string | null
    view_id: string | null
  } | null>(null)

  const apiBase =
    (process.env.NEXT_PUBLIC_BACKEND_URL || '').trim().replace(/\/$/, '') || '/api-backend'
  const [setterNames, setSetterNames] = useState<string[]>([])
  const [closerNames, setCloserNames] = useState<string[]>([])

  // Dynamic columns based on team members
  const COLUMNS = useMemo(() => buildColumns(setterNames, closerNames), [setterNames, closerNames])

  // UI state
  const [statusTab, setStatusTab] = useState('Todos')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortConfig>({ field: 'date', dir: 'desc' })
  const [filters, setFilters] = useState<FilterConfig[]>([])
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() =>
    new Set(buildColumns([], []).filter(c => c.defaultVisible).map(c => c.key))
  )
  const prevLeadsSource = useRef<'supabase' | 'airtable'>('supabase')
  const [groupBy, setGroupBy] = useState<string | null>(null)
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())

  // Modal (only for editing existing leads)
  const [showModal, setShowModal] = useState(false)
  const [editLead, setEditLead] = useState<Lead | null>(null)

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

  // ── Data fetching ──
  const fetchTeamMembers = useCallback(async () => {
    if (!ready) return
    const { data } = await supabase.from('team_members').select('name, role').eq('is_active', true)
    if (data) {
      setSetterNames(data.filter(m => m.role === 'setter').map(m => m.name))
      setCloserNames(data.filter(m => m.role === 'closer').map(m => m.name))
    }
  }, [ready, supabase])

  const fetchLeads = useCallback(async () => {
    if (!ready) return
    setLoading(true)
    setAirtableMeta(null)

    if (userId) {
      try {
        const ar = await fetch(`${apiBase}/airtable/leads`, {
          headers: { 'X-User-Id': userId },
        })
        const rawText = await ar.text()
        const data = (() => {
          try { return rawText ? JSON.parse(rawText) : {} } catch { return {} }
        })() as {
          records?: { id: string; createdTime?: string; fields?: Record<string, unknown> }[]
          table_name?: string | null
          base_id?: string | null
          table_id?: string | null
          view_id?: string | null
          detail?: string
        }
        if (ar.ok && Array.isArray(data.records)) {
          const mapped = data.records
            .filter(r => r && typeof r.id === 'string' && r.fields && typeof r.fields === 'object')
            .map(r => mapAirtableRecordToLead({
              id: r.id,
              createdTime: r.createdTime,
              fields: r.fields as Record<string, unknown>,
            }))
          setLeadsDataSource('airtable')
          setAirtableMeta({
            table_name: data.table_name ?? null,
            base_id: data.base_id ?? null,
            table_id: data.table_id ?? null,
            view_id: data.view_id ?? null,
          })
          setLeads(mapped)
          setLoading(false)
          return
        }
        if (!ar.ok && rawText) {
          try {
            const errJson = JSON.parse(rawText) as { detail?: string }
            if (errJson.detail) {
              console.error('Airtable leads:', errJson.detail)
            }
          } catch { /* ignore */ }
        }
      } catch (e) {
        console.error('Airtable leads fetch:', e)
      }
    }

    setLeadsDataSource('supabase')
    const { data, error } = await supabase
      .from('leads').select('*').eq('month', month)
      .order('created_at', { ascending: false })
    if (error) console.error('Leads fetch error:', error)
    setLeads((data as Lead[]) || [])
    setLoading(false)
  }, [month, ready, supabase, userId, apiBase])

  useEffect(() => { fetchTeamMembers() }, [fetchTeamMembers])
  useEffect(() => { fetchLeads() }, [fetchLeads])
  useEffect(() => { setSelectedRows(new Set()) }, [month, statusTab])

  /** Airtable: mostrar todas las columnas del modelo (muchas venían ocultas por defaultVisible: false). */
  useEffect(() => {
    if (leadsDataSource === 'airtable' && prevLeadsSource.current !== 'airtable') {
      setVisibleColumns(new Set(COLUMNS.map(c => c.key)))
    } else if (leadsDataSource === 'supabase' && prevLeadsSource.current === 'airtable') {
      setVisibleColumns(new Set(COLUMNS.filter(c => c.defaultVisible).map(c => c.key)))
    }
    prevLeadsSource.current = leadsDataSource
  }, [leadsDataSource, COLUMNS])

  // ── CRUD ──
  const handleSave = async (form: Record<string, string>) => {
    if (!userId) return
    if (editLead?.id?.startsWith('rec')) {
      toast('Los leads de Airtable son solo lectura en esta vista.')
      return
    }
    const row = {
      user_id: userId,
      client_name: form.client_name || '',
      source_type: form.source_type || 'manual',
      amount: Number(form.amount) || 0,
      ig_handle: form.ig_handle || null,
      phone: form.phone || null,
      avatar_type: form.avatar_type || null,
      status: form.status || 'Pendiente',
      origin: form.origin || null,
      entry_channel: form.entry_channel || null,
      entry_funnel: form.entry_funnel || null,
      agenda_point: form.agenda_point || null,
      ctas_responded: Number(form.ctas_responded) || 0,
      first_contact_at: form.first_contact_at || null,
      scheduled_at: form.scheduled_at || null,
      call_at: form.call_at || null,
      call_link: form.call_link || null,
      closer_report: form.closer_report || null,
      program_offered: form.program_offered || null,
      program_purchased: form.program_purchased || null,
      revenue: Number(form.revenue) || 0,
      payment: Number(form.payment) || 0,
      owed: Number(form.owed) || 0,
      closer: form.closer || null,
      setter: form.setter || null,
      notes: form.notes || null,
      date: form.date || new Date().toISOString().split('T')[0],
      month,
    }
    if (editLead) {
      await supabase.from('leads').update({ ...row, updated_at: new Date().toISOString() }).eq('id', editLead.id)
      toast('Lead actualizado ✓')
    } else {
      await supabase.from('leads').insert(row)
      toast('Lead agregado ✓')
    }
    setShowModal(false)
    setEditLead(null)
    fetchLeads()
  }

  const handleDelete = async (ids: string[]) => {
    const blocked = ids.filter(id => id.startsWith('rec'))
    if (blocked.length) {
      toast('No se pueden eliminar filas de Airtable desde acá.')
      return
    }
    for (const id of ids) {
      await supabase.from('leads').delete().eq('id', id)
    }
    toast(`${ids.length > 1 ? ids.length + ' leads eliminados' : 'Eliminado'} ✓`)
    setSelectedRows(new Set())
    fetchLeads()
  }

  const handleInlineUpdate = async (id: string, field: string, value: string | number | null) => {
    if (id.startsWith('rec')) {
      toast('Solo lectura: editá la fila en Airtable.')
      setEditingCell(null)
      return
    }
    await supabase.from('leads').update({ [field]: value, updated_at: new Date().toISOString() }).eq('id', id)
    setLeads(prev => prev.map(l => l.id === id ? { ...l, [field]: value } : l))
    setEditingCell(null)
  }

  const handleAddRow = async () => {
    if (leadsDataSource === 'airtable') {
      toast('Agregá filas en Airtable; acá solo se muestran.')
      return
    }
    if (!userId || addingRow) return
    setAddingRow(true)
    const row = {
      user_id: userId,
      client_name: '',
      source_type: 'manual',
      amount: 0,
      status: 'Pendiente',
      revenue: 0, payment: 0, owed: 0, ctas_responded: 0,
      date: new Date().toISOString().split('T')[0],
      month,
    }
    const { data, error } = await supabase.from('leads').insert(row).select().single()
    if (error) { console.error(error); setAddingRow(false); return }
    const newLead = data as Lead
    setLeads(prev => [...prev, newLead])
    setEditingCell({ id: newLead.id, field: 'client_name' })
    setAddingRow(false)
  }

  // ── Filtering & Sorting ──
  const filtered = useMemo(() => {
    let result = [...leads]

    if (leadsDataSource === 'airtable' && month) {
      result = result.filter(l => {
        const m = l.month
        if (!m) return true
        return m === month
      })
    }

    // Status tab (comparación canónica: Airtable suele mandar variantes de texto / mayúsculas)
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
  }, [leads, leadsDataSource, month, statusTab, search, filters, sort])

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

  const activeColumns = COLUMNS.filter(c => visibleColumns.has(c.key))

  if (!ready) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>

  const readOnlyGrid = leadsDataSource === 'airtable'

  const openLeadEditor = (lead: Lead) => {
    if (lead.id.startsWith('rec')) {
      const text = [`ID Airtable: ${lead.id}`, '', lead.notes || '(sin notas / campos extra en esta fila)'].join('\n')
      setTextPreview({ title: lead.client_name || 'Lead Airtable', text })
      return
    }
    setEditLead(lead)
    setShowModal(true)
  }

  return (
    <div className="flex flex-col h-full">
      {readOnlyGrid && (
        <div className="mb-3 rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-2.5 text-[12px] text-[var(--text2)]">
          <span className="font-semibold text-[var(--text)]">Airtable</span>
          {' · '}
          Tabla <span className="font-mono text-[var(--accent)]">{airtableMeta?.table_name || '—'}</span>
          {airtableMeta?.table_id && (
            <>
              {' · '}
              ID <span className="font-mono text-[10px]">{airtableMeta.table_id}</span>
            </>
          )}
          {airtableMeta?.base_id && (
            <>
              {' · '}
              Base <span className="font-mono text-[10px]">{airtableMeta.base_id}</span>
            </>
          )}
          {airtableMeta?.view_id && (
            <>
              {' · '}
              Vista <span className="font-mono text-[10px]">{airtableMeta.view_id}</span>
            </>
          )}
          <span className="text-[var(--text3)]"> — Solo lectura; los cambios se hacen en Airtable.</span>
        </div>
      )}
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
              <button onClick={() => handleDelete(Array.from(selectedRows))}
                className="px-2 py-1 text-[11px] text-[#F87171] hover:bg-[rgba(248,113,113,0.1)] rounded transition-colors">
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
              <AirtableTable
                leads={groupLeads} columns={activeColumns} sort={sort}
                editingCell={editingCell} setEditingCell={setEditingCell}
                onInlineUpdate={handleInlineUpdate} onToggleSort={toggleSort}
                selectedRows={selectedRows} onToggleRow={toggleSelectRow}
                onToggleAll={toggleSelectAll} allSelected={selectedRows.size === filtered.length}
                onOpenEdit={openLeadEditor}
                onDelete={(id) => handleDelete([id])}
                onAddRow={handleAddRow}
                addingRow={addingRow}
                totalLeads={filtered.length}
                onPreviewText={(title, text) => setTextPreview({ title, text })}
                readOnly={readOnlyGrid}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg2)]">
          <AirtableTable
            leads={filtered} columns={activeColumns} sort={sort}
            editingCell={editingCell} setEditingCell={setEditingCell}
            onInlineUpdate={handleInlineUpdate} onToggleSort={toggleSort}
            selectedRows={selectedRows} onToggleRow={toggleSelectRow}
            onToggleAll={toggleSelectAll} allSelected={selectedRows.size === filtered.length && filtered.length > 0}
            onOpenEdit={openLeadEditor}
            onDelete={(id) => handleDelete([id])}
            onAddRow={handleAddRow}
            addingRow={addingRow}
            totalLeads={filtered.length}
            onPreviewText={(title, text) => setTextPreview({ title, text })}
            readOnly={readOnlyGrid}
          />
        </div>
      )}

      {/* ━━ MODAL (edit only) ━━ */}
      {editLead && (
        <Modal open={showModal} onClose={() => { setShowModal(false); setEditLead(null) }} title="Editar Lead" maxWidth="720px">
          <LeadForm lead={editLead} onSave={handleSave} onCancel={() => { setShowModal(false); setEditLead(null) }} setterNames={setterNames} closerNames={closerNames} />
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
// AIRTABLE TABLE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function AirtableTable({ leads, columns, sort, editingCell, setEditingCell, onInlineUpdate, onToggleSort, selectedRows, onToggleRow, onToggleAll, allSelected, onOpenEdit, onDelete, onAddRow, addingRow, totalLeads, onPreviewText, readOnly }: {
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
  onOpenEdit: (lead: Lead) => void
  onDelete: (id: string) => void
  onAddRow: () => void
  addingRow: boolean
  totalLeads: number
  onPreviewText: (title: string, text: string) => void
  readOnly?: boolean
}) {
  return (
    <table className="w-full border-collapse" style={{ minWidth: columns.reduce((s, c) => s + c.width, 100) }}>
      <thead className="sticky top-0 z-20">
        <tr className="bg-[var(--bg3)] border-b border-[var(--border2)]">
          {/* Checkbox */}
          <th className="w-10 px-2 py-2 text-center">
            <input type="checkbox" checked={allSelected} onChange={onToggleAll} disabled={readOnly}
              className="w-3.5 h-3.5 rounded border-[var(--border2)] bg-transparent accent-[var(--accent)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" />
          </th>
          {/* Row number */}
          <th className="w-10 px-1 py-2 text-center text-[10px] font-medium text-[var(--text3)]">#</th>
          {/* Columns */}
          {columns.map(col => (
            <th key={col.key}
              onClick={() => onToggleSort(col.key)}
              className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)] hover:text-[var(--text2)] cursor-pointer select-none whitespace-nowrap transition-colors"
              style={{ width: col.width, minWidth: col.width }}>
              <div className="flex items-center gap-1">
                {col.label}
                {sort.field === col.key && (
                  <span className="text-[var(--accent)] text-[9px]">{sort.dir === 'asc' ? '↑' : '↓'}</span>
                )}
              </div>
            </th>
          ))}
          {/* Actions */}
          <th className="w-10" />
        </tr>
      </thead>
      <tbody>
        {leads.map((lead, idx) => (
          <tr key={lead.id}
            className={`border-b border-[var(--border)] transition-colors group ${
              selectedRows.has(lead.id) ? 'bg-[rgba(230,57,70,0.06)]' : 'hover:bg-[rgba(255,255,255,0.02)]'
            }`}>
            {/* Checkbox */}
            <td className="px-2 py-1.5 text-center">
              <input type="checkbox" checked={selectedRows.has(lead.id)} onChange={() => onToggleRow(lead.id)} disabled={readOnly}
                className="w-3.5 h-3.5 rounded border-[var(--border2)] bg-transparent accent-[var(--accent)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" />
            </td>
            {/* Row number */}
            <td className="px-1 py-1.5 text-center text-[11px] font-mono-num text-[var(--text3)]">{idx + 1}</td>
            {/* Cells */}
            {columns.map(col => (
              <td key={col.key} className="px-3 py-1.5" style={{ width: col.width, minWidth: col.width }}>
                <AirtableCell
                  lead={lead} col={col}
                  editing={editingCell?.id === lead.id && editingCell?.field === col.key}
                  onStartEdit={() => setEditingCell({ id: lead.id, field: col.key })}
                  onCancelEdit={() => setEditingCell(null)}
                  onSave={(value) => onInlineUpdate(lead.id, col.key, value)}
                  onOpenFullEdit={() => onOpenEdit(lead)}
                  onPreviewText={onPreviewText}
                  readOnly={readOnly}
                />
              </td>
            ))}
            {/* Delete */}
            <td className="px-2 py-1.5 text-center">
              {!readOnly && (
                <button onClick={() => onDelete(lead.id)}
                  className="opacity-0 group-hover:opacity-100 text-[var(--text3)] hover:text-[#F87171] transition-all text-sm">
                  ×
                </button>
              )}
            </td>
          </tr>
        ))}
        {/* Empty next-row number hint */}
        <tr className="border-b border-[var(--border)]">
          <td className="px-2 py-1.5" />
          <td className="px-1 py-1.5 text-center text-[11px] font-mono-num text-[var(--text3)] opacity-40">{totalLeads + 1}</td>
          <td colSpan={columns.length + 1} />
        </tr>
        {/* + Nuevo lead row */}
        {!readOnly && (
          <tr className="bg-[var(--bg)] hover:bg-[rgba(255,255,255,0.02)] transition-colors cursor-pointer"
            onClick={onAddRow}>
            <td colSpan={columns.length + 3} className="px-3 py-2">
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
// AIRTABLE CELL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function AirtableCell({ lead, col, editing, onStartEdit, onCancelEdit, onSave, onOpenFullEdit, onPreviewText, readOnly }: {
  lead: Lead
  col: ColumnDef
  editing: boolean
  onStartEdit: () => void
  onCancelEdit: () => void
  onSave: (value: string | number | null) => void
  onOpenFullEdit: () => void
  onPreviewText: (title: string, text: string) => void
  readOnly?: boolean
}) {
  const value = (lead as Record<string, unknown>)[col.key]

  if (readOnly) {
    if (col.key === 'client_name') {
      return (
        <span onClick={onOpenFullEdit}
          className="text-[13px] font-medium cursor-pointer hover:text-[var(--accent)] transition-colors truncate block">
          {String(value || '—')}
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
      return (
        <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: color + '20', color }}>
          {String(value || '—')}
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
      return <span className="text-[12px] font-mono-num text-[var(--text2)]">{String(value)}</span>
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
    const longTextKeys = ['dolores_setting', 'dolores_setting_detail', 'notes']
    if (longTextKeys.includes(col.key) && value) {
      const text = String(value)
      const preview = text.length > 60 ? `${text.substring(0, 60)}...` : text
      return (
        <span onClick={() => onPreviewText(col.label, text)} className="text-[12px] text-[var(--text2)] cursor-pointer truncate block" title={text}>
          {preview}
        </span>
      )
    }
    if ((col.key === 'entry_funnel' || col.key === 'agenda_point') && value) {
      const text = String(value)
      const isHistoria = /^historia/i.test(text)
      const isReel = /^reel/i.test(text)
      const isPerfil = /^perfil$/i.test(text)
      if (isHistoria || isReel || isPerfil) {
        const color = isHistoria ? '#A855F7' : isReel ? '#3B82F6' : '#6B7280'
        return (
          <span
            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium truncate max-w-full"
            style={{ backgroundColor: color + '18', color, border: `1px solid ${color}30` }}>
            {text}
          </span>
        )
      }
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
      return (
        <select autoFocus defaultValue={String(value || '')}
          onBlur={(e) => onSave(e.target.value || null)}
          onChange={(e) => onSave(e.target.value || null)}
          className="w-full rounded border border-[var(--accent)] bg-[var(--bg3)] px-2 py-1 text-[12px] text-[var(--text)] outline-none">
          {col.options!.map(o => <option key={o} value={o}>{o || '—'}</option>)}
        </select>
      )
    }
    return (
      <input
        autoFocus
        type={col.type === 'number' || col.type === 'currency' ? 'number' : col.type === 'date' ? 'date' : 'text'}
        defaultValue={String(value ?? '')}
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

  // Name column — special treatment
  if (col.key === 'client_name') {
    return (
      <span onClick={onOpenFullEdit}
        className="text-[13px] font-medium cursor-pointer hover:text-[var(--accent)] transition-colors truncate block">
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

  // Select (status)
  if (col.type === 'select') {
    const color = col.colors?.[String(value)] || '#888'
    return (
      <select value={String(value || '')}
        onChange={(e) => onSave(e.target.value)}
        className="rounded-full border-0 px-2.5 py-0.5 text-[11px] font-semibold outline-none cursor-pointer appearance-none"
        style={{ backgroundColor: color + '20', color }}>
        {col.options!.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
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
    const dateStr = String(value)
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
  const longTextKeys = ['dolores_setting', 'dolores_setting_detail', 'notes']
  if (longTextKeys.includes(col.key) && value) {
    const text = String(value)
    const preview = text.length > 60 ? text.substring(0, 60) + '...' : text
    return (
      <span onClick={onStartEdit} className={`${cellClass} text-[var(--text2)] cursor-pointer`} title={text}>
        {preview}
      </span>
    )
  }

  // Content reference badges (entry_funnel, agenda_point)
  if ((col.key === 'entry_funnel' || col.key === 'agenda_point') && value) {
    const text = String(value)
    const isHistoria = /^historia/i.test(text)
    const isReel = /^reel/i.test(text)
    const isPerfil = /^perfil$/i.test(text)
    if (isHistoria || isReel || isPerfil) {
      const color = isHistoria ? '#A855F7' : isReel ? '#3B82F6' : '#6B7280'
      return (
        <span onClick={onStartEdit}
          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium cursor-pointer truncate max-w-full"
          style={{ backgroundColor: color + '18', color, border: `1px solid ${color}30` }}>
          {text}
        </span>
      )
    }
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LEAD FORM MODAL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function LeadForm({ lead, onSave, onCancel, setterNames, closerNames }: {
  lead: Lead | null
  onSave: (d: Record<string, string>) => void
  onCancel: () => void
  setterNames: string[]
  closerNames: string[]
}) {
  const [form, setForm] = useState<Record<string, string>>({})

  useEffect(() => {
    if (lead) {
      const f: Record<string, string> = {}
      Object.entries(lead).forEach(([k, v]) => { f[k] = v != null ? String(v) : '' })
      setForm(f)
    } else {
      setForm({ status: 'Pendiente', date: new Date().toISOString().split('T')[0] })
    }
  }, [lead])

  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))

  const selectField = (key: string, label: string, opts: string[]) => (
    <div key={key}>
      <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">{label}</label>
      <select value={form[key] || ''} onChange={e => set(key, e.target.value)}
        className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none cursor-pointer focus:border-[var(--text3)]">
        {opts.map(o => <option key={o} value={o}>{o || '—'}</option>)}
      </select>
    </div>
  )

  const textField = (key: string, label: string, type = 'text') => (
    <div key={key}>
      <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">{label}</label>
      <input type={type} value={form[key] || ''} onChange={e => set(key, e.target.value)}
        className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]" />
    </div>
  )

  const textAreaField = (key: string, label: string, rows = 6) => (
    <div key={key}>
      <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">{label}</label>
      <textarea rows={rows} value={form[key] || ''} onChange={e => set(key, e.target.value)}
        className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)] resize-y whitespace-pre-wrap" />
    </div>
  )

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        {textField('client_name', 'Nombre')}
        {textField('ig_handle', 'IG Handle')}
        {textField('phone', 'Teléfono')}
        {selectField('avatar_type', 'Avatar', AVATAR_OPTIONS)}
        {selectField('status', 'Status', STATUS_OPTIONS)}
        {selectField('setter', 'Setter', ['', ...setterNames])}
        {selectField('entry_channel', 'Agendó en', CHANNEL_OPTIONS)}
        {textField('entry_funnel', 'Ingreso embudo')}
        {textField('agenda_point', 'Punto de agenda')}
        {textField('ctas_responded', 'CTAs respondidas', 'number')}
        {textField('first_contact_at', '1er contacto', 'date')}
        {textField('scheduled_at', 'Agendó', 'date')}
        {textField('call_at', 'Call', 'date')}
        {textField('call_link', 'Link llamada')}
        {selectField('program_offered', 'Prog. ofrecido', PROGRAM_OPTIONS)}
        {selectField('program_purchased', 'Prog. comprado', PROGRAM_OPTIONS)}
        {textField('revenue', 'Ingresos $', 'number')}
        {textField('payment', 'Pago $', 'number')}
        {textField('owed', 'Debe $', 'number')}
        {selectField('closer', 'Closer', ['', ...closerNames])}
        {textField('setter', 'Setter')}
        {textField('date', 'Fecha', 'date')}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {textField('email', 'Email')}
        {textField('ingresos_mensuales', 'Ingresos mensuales USD', 'number')}
        {textField('pago_en_llamada', 'Pago en llamada $', 'number')}
        {textField('compromiso', 'Compromiso')}
        {textField('urgencia', 'Urgencia')}
        {textField('disposicion_invertir', 'Disposición a invertir')}
      </div>
      <div className="mt-3">{textAreaField('dolores_setting', 'Dolores de setting', 3)}</div>
      <div className="mt-3">{textAreaField('dolores_setting_detail', 'Detalle dolores setting', 3)}</div>
      <div className="mt-3">{textAreaField('dolores_llamada', 'Dolores de la llamada', 4)}</div>
      <div className="mt-3">{textAreaField('razon_compra', 'Razón de compra', 3)}</div>
      <div className="mt-3">{textAreaField('closer_report', 'Reporte closer', 10)}</div>
      <div className="mt-3">{textAreaField('notes', 'Notas', 3)}</div>
      <div className="flex justify-end gap-3 pt-5">
        <button onClick={onCancel}
          className="rounded-lg border border-[var(--border2)] px-5 py-2.5 text-[11px] font-semibold uppercase text-[var(--text2)] hover:border-[var(--text3)] transition-colors">
          Cancelar
        </button>
        <button onClick={() => onSave(form)}
          className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase text-white hover:brightness-110 transition-all">
          Guardar
        </button>
      </div>
    </div>
  )
}
