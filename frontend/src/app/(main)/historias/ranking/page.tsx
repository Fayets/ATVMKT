'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { resolveMediaUrl } from '@/shared/lib/backend-public-url'
import { apiFetch } from '@/lib/api'

type StorySlide = {
  id: number
  order_index: number
  image_url: string | null
  instagram_media_id: string | null
  views: number | null
  reach: number | null
  shares: number | null
  replies: number | null
  navigation: number | null
  profile_visits: number | null
}

type StorySequence = {
  id: number
  sequence_date: string
  cta_text: string | null
  has_cta: boolean
  slides: StorySlide[]
}

type Secuencia = {
  id: number
  fecha: string
  conCta: boolean
  piezas: StorySlide[]
  respuestas: number
  alcance: number
}

type Periodo = 'todo' | '30' | '90' | string

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const TOP = 30

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}
const fmt = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 0 })

const hasCtaValue = (value: string | null | undefined): boolean => {
  const v = (value || '').trim().toLowerCase()
  if (!v) return false
  return !['no', 'sin cta', 'ninguno', 'none', 'false', '0', 'n/a'].includes(v)
}

function fechaLarga(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const f = new Date(y, m - 1, d)
  return `${DIAS[f.getDay()]} ${d} de ${MESES[m - 1]} ${y}`
}

function haceDias(dias: number): string {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Misma story de IG no cuenta dos veces (manual + sync o doble sync). */
function dedupe(slides: StorySlide[]): StorySlide[] {
  const vistos = new Set<string>()
  return [...slides]
    .sort((a, b) => a.order_index - b.order_index || a.id - b.id)
    .filter((s) => {
      const id = String(s.instagram_media_id ?? '').trim()
      if (!id) return true
      if (vistos.has(id)) return false
      vistos.add(id)
      return true
    })
}

export default function RankingHistoriasPage() {
  const { ready } = useAuthUser()
  const [raw, setRaw] = useState<StorySequence[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [periodo, setPeriodo] = useState<Periodo>('todo')
  const [abierta, setAbierta] = useState<{ sec: Secuencia; i: number } | null>(null)

  useEffect(() => {
    if (!ready) return
    setLoading(true)
    apiFetch('/stories/sequences?all_months=true')
      .then(async (r) => {
        const data = await r.json().catch(() => [])
        if (!r.ok || !Array.isArray(data)) throw new Error()
        setRaw(data as StorySequence[])
      })
      .catch(() => setError('No se pudieron cargar las historias.'))
      .finally(() => setLoading(false))
  }, [ready])

  useEffect(() => {
    if (!abierta) return
    const teclas = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierta(null)
      if (e.key === 'ArrowRight') setAbierta((a) => a && { ...a, i: Math.min(a.i + 1, a.sec.piezas.length - 1) })
      if (e.key === 'ArrowLeft') setAbierta((a) => a && { ...a, i: Math.max(a.i - 1, 0) })
    }
    window.addEventListener('keydown', teclas)
    return () => window.removeEventListener('keydown', teclas)
  }, [abierta])

  const meses = useMemo(
    () => [...new Set(raw.map((s) => s.sequence_date.slice(0, 7)))].sort((a, b) => b.localeCompare(a)),
    [raw],
  )

  const ranking = useMemo<Secuencia[]>(() => {
    const enPeriodo = (iso: string) => {
      if (periodo === 'todo') return true
      if (periodo === '30' || periodo === '90') return iso.slice(0, 10) >= haceDias(Number(periodo))
      return iso.startsWith(periodo)
    }
    return raw
      .filter((s) => enPeriodo(s.sequence_date))
      .map((s) => {
        const piezas = dedupe(s.slides || [])
        return {
          id: s.id,
          fecha: s.sequence_date.slice(0, 10),
          conCta: Boolean(s.has_cta) || hasCtaValue(s.cta_text),
          piezas,
          respuestas: piezas.reduce((t, p) => t + num(p.replies), 0),
          // Alcance de la secuencia = el de su primera pieza: las siguientes las ve un subconjunto.
          alcance: num(piezas[0]?.reach),
        }
      })
      .sort((a, b) => b.respuestas - a.respuestas)
      .slice(0, TOP)
  }, [raw, periodo])

  if (!ready || loading) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>
  if (error) return <div className="py-12 text-center text-[var(--red)]">{error}</div>

  const chip = (activo: boolean) =>
    `rounded-lg px-3 py-1.5 text-[11px] font-semibold uppercase transition-colors ${
      activo ? 'bg-[var(--accent)] text-white' : 'border border-[var(--border2)] text-[var(--text3)] hover:text-[var(--text)]'
    }`

  const pieza = abierta ? abierta.sec.piezas[abierta.i] : null

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">
          <Link href="/historias" className="text-[var(--text3)] hover:text-[var(--text)]">Historias</Link>
          <span className="text-[var(--text3)]"> / </span>Ranking
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {(['todo', '30', '90'] as const).map((p) => (
            <button key={p} type="button" className={chip(periodo === p)} onClick={() => setPeriodo(p)}>
              {p === 'todo' ? 'Todo' : `Últimos ${p} días`}
            </button>
          ))}
          <select
            value={meses.includes(periodo) ? periodo : ''}
            onChange={(e) => e.target.value && setPeriodo(e.target.value)}
            className={`${chip(meses.includes(periodo))} bg-transparent outline-none`}
          >
            <option value="">Mes…</option>
            {meses.map((m) => (
              <option key={m} value={m}>
                {MESES[Number(m.slice(5, 7)) - 1]} {m.slice(0, 4)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {ranking.length === 0 ? (
        <div className="py-12 text-center text-[12px] text-[var(--text3)]">No hay historias en este período.</div>
      ) : (
        <div className="flex flex-col gap-4">
          {ranking.map((s, pos) => (
            <div key={s.id} className="glass-card glass-card--performant p-5">
              <div className="mb-4 flex items-baseline gap-4">
                <div className={`font-mono-num text-2xl font-bold ${pos < 3 ? 'text-[var(--accent)]' : 'text-[var(--text3)]'}`}>
                  {pos + 1}
                </div>
                <div className="flex-1 text-[15px] font-semibold">
                  {fechaLarga(s.fecha)}
                  {s.conCta && (
                    <span className="ml-2 rounded bg-[var(--accent)] px-1.5 py-0.5 align-middle text-[9px] font-bold uppercase text-white">CTA</span>
                  )}
                </div>
                <div className="text-right">
                  <span className="font-mono-num text-2xl font-bold">{fmt(s.respuestas)}</span>
                  <span className="ml-2 text-[11px] text-[var(--text3)]">respuestas · {fmt(s.alcance)} alcance</span>
                </div>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {s.piezas.map((p, i) => (
                  <button key={p.id} type="button" onClick={() => setAbierta({ sec: s, i })} className="w-[120px] shrink-0 text-left">
                    <div className="aspect-[9/16] w-full overflow-hidden rounded-lg bg-[var(--bg3)]">
                      {p.image_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={resolveMediaUrl(p.image_url)} alt="" loading="lazy" className="h-full w-full object-cover" />
                      )}
                    </div>
                    <div className="mt-1.5 flex justify-between text-[11px]">
                      <span className="text-[var(--text3)]">#{i + 1}</span>
                      <span className={`font-mono-num ${num(p.replies) > 0 && num(p.replies) === Math.max(...s.piezas.map((x) => num(x.replies))) ? 'font-semibold text-[var(--accent)]' : 'text-[var(--text2)]'}`}>
                        {fmt(num(p.replies))} resp
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {abierta && pieza && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" onClick={() => setAbierta(null)}>
          <div className="flex max-h-full items-center gap-6" onClick={(e) => e.stopPropagation()}>
            {pieza.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={resolveMediaUrl(pieza.image_url)} alt="" className="max-h-[85vh] rounded-xl object-contain" />
            ) : (
              <div className="flex h-[60vh] w-[34vh] items-center justify-center rounded-xl bg-[var(--bg3)] text-[var(--text3)]">Sin imagen</div>
            )}
            <div className="min-w-[180px] text-[12px]">
              <div className="text-[14px] font-semibold text-white">{fechaLarga(abierta.sec.fecha)}</div>
              <div className="mb-4 text-zinc-400">Pieza {abierta.i + 1} de {abierta.sec.piezas.length}</div>
              {[
                ['Respuestas', num(pieza.replies)],
                ['Alcance', num(pieza.reach)],
                ['Vistas', num(pieza.views)],
                ['Visitas al perfil', num(pieza.profile_visits)],
                ['Compartidos', num(pieza.shares)],
              ].map(([k, v]) => (
                <div key={k as string} className="flex justify-between gap-6 border-b border-white/10 py-1.5 text-zinc-300">
                  <span>{k}</span>
                  <span className="font-mono-num text-white">{fmt(v as number)}</span>
                </div>
              ))}
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  disabled={abierta.i === 0}
                  onClick={() => setAbierta({ ...abierta, i: abierta.i - 1 })}
                  className="rounded-md bg-white/10 px-3 py-1.5 text-white disabled:opacity-30"
                >
                  ←
                </button>
                <button
                  type="button"
                  disabled={abierta.i === abierta.sec.piezas.length - 1}
                  onClick={() => setAbierta({ ...abierta, i: abierta.i + 1 })}
                  className="rounded-md bg-white/10 px-3 py-1.5 text-white disabled:opacity-30"
                >
                  →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
