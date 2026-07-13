'use client'

import type { CallReport } from '../types'
import { formatIsoDateDdMmYyyy } from '@/shared/lib/format-utils'

type Props = {
  report: CallReport
}

function FieldBlock({ label, value }: { label: string; value: string | null | undefined }) {
  const text = (value || '').trim()
  if (!text) return null
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text3)]">{label}</div>
      <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--text2)]">{text}</div>
    </div>
  )
}

export function CallReportDetail({ report }: Props) {
  if (report.estado === 'error') {
    return (
      <div className="rounded-lg border border-[var(--red)]/30 bg-[var(--red)]/5 p-4 text-[13px] text-[var(--red)]">
        {report.error_msg || 'Error al analizar la llamada.'}
      </div>
    )
  }

  if (report.estado === 'pendiente' || report.estado === 'procesando') {
    return (
      <div className="py-3 text-[13px] text-[var(--text3)]">
        {report.estado === 'procesando'
          ? 'Analizando la llamada con Claude…'
          : 'En cola para análisis…'}
      </div>
    )
  }

  return (
    <div className="space-y-4 border-t border-[var(--border)] pt-4">
      <FieldBlock label="Estado de la llamada" value={report.status_llamada} />
      <FieldBlock label="Programa ofrecido" value={report.program_offered} />
      <FieldBlock label="Reporte del closer" value={report.closer_report} />
      <FieldBlock label="Dolores de la llamada" value={report.dolores_llamada} />
      <FieldBlock label="Razón de compra" value={report.razon_compra} />
    </div>
  )
}

export function formatReportDate(iso: string | null | undefined): string {
  return formatIsoDateDdMmYyyy(iso) || '—'
}
