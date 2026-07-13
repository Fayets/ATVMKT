'use client'

import { useMemo, useState } from 'react'
import type { CallReport } from '../types'
import { ESTADO_COLORS, ESTADO_LABELS } from '../types'
import { CallReportDetail, formatReportDate } from './CallReportDetail'

type Props = {
  items: CallReport[]
  loading: boolean
}

function EstadoBadge({ estado }: { estado: string }) {
  const key = (estado || 'pendiente').toLowerCase()
  const color = ESTADO_COLORS[key] || '#94A3B8'
  const label = ESTADO_LABELS[key] || estado
  return (
    <span
      className="inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ background: `${color}22`, color }}
    >
      {label}
    </span>
  )
}

export function CallReportsTable({ items, loading }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const sorted = useMemo(
    () => [...items].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')),
    [items],
  )

  if (loading && sorted.length === 0) {
    return <div className="py-12 text-center text-[13px] text-[var(--text3)]">Cargando reportes…</div>
  }

  if (sorted.length === 0) {
    return (
      <div className="glass-card py-12 text-center text-[13px] text-[var(--text3)]">
        No hay reportes todavía. Pegá un link de Fathom en la columna &quot;Link de llamada&quot; de un lead.
      </div>
    )
  }

  return (
    <div className="glass-card overflow-hidden">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-[var(--border)] text-[10px] font-semibold uppercase tracking-wide text-[var(--text3)]">
            <th className="px-4 py-3">Lead</th>
            <th className="px-4 py-3">Fecha</th>
            <th className="px-4 py-3">Estado</th>
            <th className="px-4 py-3">Link Fathom</th>
            <th className="px-4 py-3 w-10" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const open = expandedId === row.id
            return (
              <tr key={row.id} className="border-b border-[var(--border)]/60 align-top">
                <td colSpan={5} className="p-0">
                  <button
                    type="button"
                    className="grid w-full grid-cols-[1.2fr_0.7fr_0.7fr_1.4fr_40px] items-center gap-2 px-4 py-3 text-left hover:bg-[var(--bg3)]/40"
                    onClick={() => setExpandedId(open ? null : row.id)}
                  >
                    <span className="font-medium text-[var(--text)] truncate">
                      {row.lead_nombre || 'Sin nombre'}
                    </span>
                    <span className="font-mono-num text-[var(--text2)]">{formatReportDate(row.created_at)}</span>
                    <span>
                      <EstadoBadge estado={row.estado} />
                    </span>
                    <a
                      href={row.fathom_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-[var(--accent)] hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {row.fathom_url}
                    </a>
                    <span className="text-[var(--text3)]">{open ? '▾' : '▸'}</span>
                  </button>
                  {open && (
                    <div className="px-4 pb-4">
                      <CallReportDetail report={row} />
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
