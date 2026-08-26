'use client'

import { useMemo, useState, type ChangeEvent } from 'react'
import { formatIsoDateDdMmYyyy } from '@/shared/lib/format-utils'
import type { PendingAgendaLead } from '../types'

type Props = {
  items: PendingAgendaLead[]
  monthLabel: string
  setterOptions: string[]
  loading: boolean
  onAssign: (lead: PendingAgendaLead) => void
  /** Abre el picker del punto de agenda base (columna `via`). */
  onAssignBase: (lead: PendingAgendaLead) => void
  onSetterChange: (leadId: number, setter: string) => Promise<void>
}

function formatCallLabel(iso: string | null): string {
  if (!iso?.trim()) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const date = formatIsoDateDdMmYyyy(iso.slice(0, 10))
  const time = new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
  return `${date} ${time}`
}

function SetterSelect({
  leadId,
  setter,
  setterOptions,
  onSetterChange,
}: {
  leadId: number
  setter: string | null
  setterOptions: string[]
  onSetterChange: (leadId: number, setter: string) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const current = (setter || '').trim()
  const options = ['', ...setterOptions.filter((n) => n.trim())]
  const value =
    options.find((o) => o.toLowerCase() === current.toLowerCase()) ??
    (current || '')

  const handleChange = async (e: ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value
    if (next === value) return
    setSaving(true)
    try {
      await onSetterChange(leadId, next)
    } finally {
      setSaving(false)
    }
  }

  return (
    <select
      value={value}
      disabled={saving}
      onChange={(e) => void handleChange(e)}
      className="neo-calls__closer-select neo-agenda__setter-select"
      aria-label={`Setter de lead ${leadId}`}
    >
      {value && !options.includes(value) ? (
        <option value={value}>{value}</option>
      ) : null}
      {options.map((name) => (
        <option key={name || '__empty'} value={name}>
          {name || '—'}
        </option>
      ))}
    </select>
  )
}

export function PendingAgendaTable({
  items,
  monthLabel,
  setterOptions,
  loading,
  onAssign,
  onAssignBase,
  onSetterChange,
}: Props) {
  const [searchQuery, setSearchQuery] = useState('')

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return items
    return items.filter((row) => {
      const name = (row.client_name || '').toLowerCase()
      const ig = (row.ig_handle || '').replace(/^@/, '').toLowerCase()
      const setter = (row.setter || '').toLowerCase()
      const base = (row.entry_channel || '').toLowerCase()
      return name.includes(q) || ig.includes(q) || setter.includes(q) || base.includes(q)
    })
  }, [items, searchQuery])

  if (loading && items.length === 0) {
    return <div className="neo-panel__loading">Cargando agendas pendientes</div>
  }

  if (items.length === 0) {
    return (
      <div className="neo-panel__empty">
        <p>Todas las agendas de {monthLabel} tienen punto de agenda asignado.</p>
      </div>
    )
  }

  return (
    <div className="neo-agenda">
      <div className="neo-agenda__toolbar">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Buscar por lead, IG o setter…"
          className="neo-agenda__search"
          aria-label="Buscar agendas pendientes"
        />
        {searchQuery.trim() ? (
          <span className="neo-agenda__search-meta">
            {filteredItems.length} de {items.length}
          </span>
        ) : null}
      </div>
      {filteredItems.length === 0 ? (
        <div className="neo-panel__empty neo-agenda__empty-search">
          <p>No hay resultados para &quot;{searchQuery.trim()}&quot;.</p>
        </div>
      ) : (
        <>
      <div className="neo-agenda__head">
        <div className="neo-agenda__num">#</div>
        <div>Lead</div>
        <div>IG</div>
        <div>Call</div>
        <div>Setter</div>
        <div>Punto de agenda base</div>
        <div>Punto de agenda</div>
      </div>
      {filteredItems.map((row, index) => (
        <div key={row.id} className="neo-agenda__row">
          <div className="neo-agenda__num">{index + 1}</div>
          <div className="neo-agenda__lead" title={row.client_name || 'Sin nombre'}>
            {row.client_name || 'Sin nombre'}
          </div>
          <div className="neo-agenda__ig" title={row.ig_handle || undefined}>
            {row.ig_handle?.trim() ? `@${row.ig_handle.replace(/^@/, '')}` : '—'}
          </div>
          <div className="neo-agenda__call">{formatCallLabel(row.scheduled_at)}</div>
          <SetterSelect
            leadId={row.id}
            setter={row.setter}
            setterOptions={setterOptions}
            onSetterChange={onSetterChange}
          />
          <div className="neo-agenda__action">
            <button
              type="button"
              className="neo-panel__btn neo-panel__btn--ghost neo-agenda__assign-btn"
              onClick={() => onAssignBase(row)}
              title={row.entry_channel?.trim() || 'Sin asignar'}
            >
              {row.entry_channel?.trim() ? 'Cambiar' : 'Asignar'}
            </button>
          </div>
          <div className="neo-agenda__action">
            <button
              type="button"
              className="neo-panel__btn neo-panel__btn--ghost neo-agenda__assign-btn"
              onClick={() => onAssign(row)}
            >
              Asignar
            </button>
          </div>
        </div>
      ))}
        </>
      )}
    </div>
  )
}
