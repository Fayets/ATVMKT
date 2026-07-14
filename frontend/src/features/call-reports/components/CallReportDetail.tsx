'use client'

import type { CallReport } from '../types'
import { formatIsoDateDdMmYyyy } from '@/shared/lib/format-utils'
import { downloadCallReport } from '../services/call-reports-service'

type Props = {
  report: CallReport
  onBusy?: (busy: boolean) => void
  onError?: (msg: string) => void
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

function HeaderItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text3)]">{label}</div>
      <div className="mt-0.5 break-words text-[13px] text-[var(--text)]">{value || '—'}</div>
    </div>
  )
}

export function CallReportDetail({ report, onBusy, onError }: Props) {
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

  const resumen =
    (report.resumen || '').trim() || (report.closer_report || '').trim() || null

  async function handleDownload(format: 'pdf' | 'txt') {
    onBusy?.(true)
    try {
      await downloadCallReport(report.id, format)
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'Error al descargar.')
    } finally {
      onBusy?.(false)
    }
  }

  return (
    <div className="space-y-4 border-t border-[var(--border)] pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-[var(--border)] bg-[var(--bg2)] px-3 py-1.5 text-[12px] text-[var(--text2)] hover:bg-[var(--bg3)]"
          onClick={() => void handleDownload('pdf')}
        >
          Descargar PDF
        </button>
        <button
          type="button"
          className="rounded-md border border-[var(--border)] bg-[var(--bg2)] px-3 py-1.5 text-[12px] text-[var(--text2)] hover:bg-[var(--bg3)]"
          onClick={() => void handleDownload('txt')}
        >
          Descargar TXT
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <HeaderItem label="Fecha" value={formatReportDate(report.created_at)} />
        <HeaderItem label="Lead" value={report.lead_nombre || 'Sin nombre'} />
        <HeaderItem label="Link de la grabación" value={report.fathom_url || '—'} />
        <HeaderItem label="Participantes" value={(report.participantes || '').trim() || '—'} />
        <HeaderItem
          label="Motivo de la reunión"
          value={(report.motivo_reunion || '').trim() || '—'}
        />
      </div>

      <FieldBlock label="Resumen de la reunión" value={resumen} />
      <FieldBlock label="¿Hubo objeciones en la llamada?" value={report.hubo_objeciones} />
      <FieldBlock label="¿Qué tipo de perfil tiene el lead?" value={report.tipo_perfil} />
      <FieldBlock label="Ingresos estimados del lead" value={report.ingresos_estimados} />
      <FieldBlock
        label="¿Qué situación puntual está viviendo y qué le gustaría vivir en los próximos 3 meses?"
        value={report.situacion_y_deseo}
      />
    </div>
  )
}

export function formatReportDate(iso: string | null | undefined): string {
  return formatIsoDateDdMmYyyy(iso) || '—'
}
