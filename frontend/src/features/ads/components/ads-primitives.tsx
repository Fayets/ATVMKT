'use client'

import { useState } from 'react'
import {
  FREQ_ALERTA,
  FREQ_ESCALA_MAX,
  FREQ_QUEMADA,
  SALUD_LABEL,
  formatFrecuencia,
  type SaludCreativa,
} from '../lib/ads-metrics'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PALETA SEMÁFORO
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const SALUD_COLOR: Record<SaludCreativa, string> = {
  sana: 'var(--green)',
  alerta: 'var(--amber)',
  quemada: 'var(--accent)',
  'sin-datos': 'var(--text3)',
}

const SALUD_CHIP: Record<SaludCreativa, string> = {
  sana: 'bg-[rgba(34,197,94,0.12)] text-[var(--green)] border-[rgba(34,197,94,0.30)]',
  alerta: 'bg-[rgba(245,158,11,0.12)] text-[var(--amber)] border-[rgba(245,158,11,0.30)]',
  quemada: 'bg-[rgba(230,57,70,0.14)] text-[var(--accent)] border-[rgba(230,57,70,0.32)]',
  'sin-datos': 'bg-[var(--bg3)] text-[var(--text3)] border-[var(--border2)]',
}

export function SaludChip({ salud }: { salud: SaludCreativa }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${SALUD_CHIP[salud]}`}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: SALUD_COLOR[salud] }}
        aria-hidden
      />
      {SALUD_LABEL[salud]}
    </span>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MEDIDOR DE FRECUENCIA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Barra 0 → 2,4 con las dos marcas del módulo (1,4 alerta / 1,6 quemada).
 * La posición del cursor es lo que se lee de un vistazo; el número es secundario.
 */
export function FrecuenciaGauge({
  frecuencia,
  salud,
  compact = false,
}: {
  frecuencia: number | null
  salud: SaludCreativa
  compact?: boolean
}) {
  const pos = frecuencia == null ? 0 : Math.min(frecuencia / FREQ_ESCALA_MAX, 1) * 100
  const marcaAlerta = (FREQ_ALERTA / FREQ_ESCALA_MAX) * 100
  const marcaQuemada = (FREQ_QUEMADA / FREQ_ESCALA_MAX) * 100

  return (
    <div className={compact ? 'w-full min-w-[92px]' : 'w-full'}>
      <div
        className="relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg4)]"
        role="img"
        aria-label={`Frecuencia ${formatFrecuencia(frecuencia)}, estado ${SALUD_LABEL[salud]}`}
      >
        {/* zonas */}
        <div
          className="absolute inset-y-0 left-0 bg-[rgba(34,197,94,0.22)]"
          style={{ width: `${marcaAlerta}%` }}
        />
        <div
          className="absolute inset-y-0 bg-[rgba(245,158,11,0.22)]"
          style={{ left: `${marcaAlerta}%`, width: `${marcaQuemada - marcaAlerta}%` }}
        />
        <div
          className="absolute inset-y-0 right-0 bg-[rgba(230,57,70,0.22)]"
          style={{ left: `${marcaQuemada}%` }}
        />
        {/* cursor */}
        {frecuencia != null ? (
          <div
            className="absolute top-1/2 h-3 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: `${pos}%`, background: SALUD_COLOR[salud] }}
          />
        ) : null}
      </div>
      {!compact ? (
        <div className="mt-1 flex justify-between text-[9px] tabular-nums text-[var(--text3)]">
          <span>0</span>
          <span>1,4</span>
          <span>1,6</span>
          <span>2,4+</span>
        </div>
      ) : null}
    </div>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TARJETA DE MÉTRICA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type EstadoBenchmark = 'bueno' | 'malo' | 'neutro'

export function StatCard({
  label,
  value,
  sub,
  benchmark,
  estado = 'neutro',
  hint,
}: {
  label: string
  value: string
  sub?: string
  benchmark?: string
  estado?: EstadoBenchmark
  hint?: string
}) {
  const color =
    estado === 'bueno' ? 'var(--green)' : estado === 'malo' ? 'var(--accent)' : 'var(--text)'
  return (
    <div className="glass-card flex flex-col justify-between p-4" title={hint}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] leading-tight tracking-tight text-[var(--text3)]">{label}</div>
        {benchmark ? (
          <span
            className="shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
            style={{
              color: estado === 'neutro' ? 'var(--text3)' : color,
              borderColor: estado === 'neutro' ? 'var(--border2)' : color,
              background:
                estado === 'neutro' ? 'transparent' : `color-mix(in srgb, ${color} 12%, transparent)`,
            }}
          >
            {benchmark}
          </span>
        ) : null}
      </div>
      <div className="font-mono-num mt-2 text-2xl font-bold leading-none" style={{ color }}>
        {value}
      </div>
      {sub ? <div className="mt-1.5 text-[10px] leading-tight text-[var(--text3)]">{sub}</div> : null}
    </div>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PASO DE EMBUDO
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function EmbudoPaso({
  label,
  valor,
  costo,
  tasa,
  intensidad,
  fuente,
}: {
  label: string
  valor: string
  costo?: string
  tasa?: string
  /** 0 → 1: opacidad relativa del bloque, para leer el estrechamiento del embudo. */
  intensidad: number
  fuente: 'meta' | 'crm'
}) {
  const alpha = 0.07 + Math.max(0, Math.min(1, intensidad)) * 0.28
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {tasa ? (
        <div className="mb-1 text-center text-[10px] font-medium tabular-nums text-[var(--text3)]">
          ↓ {tasa}
        </div>
      ) : (
        <div className="mb-1 h-[15px]" aria-hidden />
      )}
      <div
        className="rounded-lg border border-[var(--border2)] px-3 py-3 text-center"
        style={{ background: `rgba(230, 57, 70, ${alpha})` }}
      >
        <div className="flex items-center justify-center gap-1.5">
          <span
            className="inline-block h-1 w-1 rounded-full"
            style={{ background: fuente === 'crm' ? 'var(--green)' : 'var(--text3)' }}
            title={fuente === 'crm' ? 'Dato del CRM' : 'Dato de Meta'}
            aria-hidden
          />
          <span className="truncate text-[10px] uppercase tracking-wide text-[var(--text2)]">
            {label}
          </span>
        </div>
        <div className="font-mono-num mt-1.5 text-xl font-bold leading-none">{valor}</div>
        {costo ? (
          <div className="font-mono-num mt-1 text-[10px] tabular-nums text-[var(--text3)]">{costo}</div>
        ) : null}
      </div>
    </div>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NOTA METODOLÓGICA PLEGABLE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function NotaPlegable({
  titulo,
  children,
}: {
  titulo: string
  children: React.ReactNode
}) {
  const [abierto, setAbierto] = useState(false)
  return (
    <div className="rounded-xl border border-[var(--border2)] bg-[var(--bg2)]">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="text-[11px] font-medium uppercase tracking-widest text-[var(--text3)]">
          {titulo}
        </span>
        <span className="text-[11px] text-[var(--text3)]">{abierto ? '−' : '+'}</span>
      </button>
      {abierto ? (
        <div className="space-y-3 border-t border-[var(--border)] px-4 py-4 text-[12px] leading-relaxed text-[var(--text2)]">
          {children}
        </div>
      ) : null}
    </div>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MINIATURA DE CAMPAÑA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function campaignThumbSrc(raw: string | undefined): string {
  const url = (raw || '').trim()
  if (!url) return ''
  if (url.startsWith('/')) return url
  return `/api/proxy-image?url=${encodeURIComponent(url)}`
}

export function CampaignThumb({ src, alt }: { src: string; alt: string }) {
  const [err, setErr] = useState(false)
  if (!src || err) {
    return (
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-dashed border-[var(--border2)] bg-[var(--bg3)] text-[9px] uppercase tracking-wide text-[var(--text3)]"
        aria-hidden
      >
        Ads
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className="h-11 w-11 shrink-0 rounded-md border border-[var(--border2)] bg-[var(--bg3)] object-cover"
      onError={() => setErr(true)}
    />
  )
}

export function estadoBadgeClass(estado: string): string {
  const u = (estado || '').toUpperCase()
  if (u === 'ACTIVE') return 'bg-[rgba(34,197,94,0.14)] text-[var(--green)] border-[rgba(34,197,94,0.28)]'
  if (u === 'PAUSED') return 'bg-[rgba(245,158,11,0.14)] text-[var(--amber)] border-[rgba(245,158,11,0.28)]'
  if (u === 'ARCHIVED' || u === 'DELETED')
    return 'bg-[var(--bg3)] text-[var(--text3)] border-[var(--border2)]'
  return 'bg-[var(--bg3)] text-[var(--text2)] border-[var(--border2)]'
}
