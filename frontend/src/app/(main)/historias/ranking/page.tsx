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
  chats: number
  slides: StorySlide[]
}

/** Una pieza con lo que hace falta para rankearla: su secuencia y su lugar en ella. */
type Pieza = StorySlide & {
  fecha: string
  posicion: number
  totalPiezas: number
  conCta: boolean
}

type Secuencia = {
  id: number
  fecha: string
  piezas: Pieza[]
  conCta: boolean
  respuestas: number
  alcance: number
  visitas: number
  compartidos: number
  mejor: Pieza | null
}

type Metrica = 'replies' | 'tasa' | 'profile_visits' | 'shares'
type Periodo = 'todo' | '30' | '90' | string

const METRICAS: { key: Metrica; label: string }[] = [
  { key: 'replies', label: 'Respuestas' },
  { key: 'tasa', label: 'Respuestas c/1.000 de alcance' },
  { key: 'profile_visits', label: 'Visitas al perfil' },
  { key: 'shares', label: 'Compartidos' },
]

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const TOP = 50

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}
const fmt = (n: number, dec = 0) =>
  n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec })

const hasCtaValue = (value: string | null | undefined): boolean => {
  const v = (value || '').trim().toLowerCase()
  if (!v) return false
  return !['no', 'sin cta', 'ninguno', 'none', 'false', '0', 'n/a'].includes(v)
}

function fechaCorta(iso: string): string {
  const m = iso.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return iso
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return `${DIAS[d.getDay()]} ${m[3]}-${m[2]}-${m[1]}`
}

function diaSemana(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

/** Respuestas por cada 1.000 personas alcanzadas: compara piezas con alcances distintos. */
const tasa = (respuestas: number, alcance: number) => (alcance > 0 ? (respuestas / alcance) * 1000 : 0)

function valorPieza(p: Pieza, m: Metrica): number {
  if (m === 'tasa') return tasa(num(p.replies), num(p.reach))
  return num(p[m])
}

function valorSecuencia(s: Secuencia, m: Metrica): number {
  if (m === 'tasa') return tasa(s.respuestas, s.alcance)
  if (m === 'replies') return s.respuestas
  if (m === 'profile_visits') return s.visitas
  return s.compartidos
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
  const [metrica, setMetrica] = useState<Metrica>('replies')
  const [vista, setVista] = useState<'piezas' | 'secuencias'>('piezas')
  const [soloCta, setSoloCta] = useState<'todas' | 'cta' | 'sin'>('todas')
  const [abierta, setAbierta] = useState<Pieza | null>(null)

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
    const cerrar = (e: KeyboardEvent) => e.key === 'Escape' && setAbierta(null)
    window.addEventListener('keydown', cerrar)
    return () => window.removeEventListener('keydown', cerrar)
  }, [abierta])

  const meses = useMemo(
    () => [...new Set(raw.map((s) => s.sequence_date.slice(0, 7)))].sort((a, b) => b.localeCompare(a)),
    [raw],
  )

  const secuencias = useMemo<Secuencia[]>(() => {
    const hoy = new Date()
    const desde = (dias: number) => {
      const d = new Date(hoy)
      d.setDate(d.getDate() - dias)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    const enPeriodo = (iso: string) => {
      if (periodo === 'todo') return true
      if (periodo === '30' || periodo === '90') return iso.slice(0, 10) >= desde(Number(periodo))
      return iso.startsWith(periodo)
    }
    return raw
      .filter((s) => enPeriodo(s.sequence_date))
      .map((s) => {
        const conCta = Boolean(s.has_cta) || hasCtaValue(s.cta_text)
        const slides = dedupe(s.slides || [])
        const piezas: Pieza[] = slides.map((sl, i) => ({
          ...sl,
          fecha: s.sequence_date.slice(0, 10),
          posicion: i + 1,
          totalPiezas: slides.length,
          conCta,
        }))
        const suma = (k: keyof StorySlide) => piezas.reduce((t, p) => t + num(p[k]), 0)
        return {
          id: s.id,
          fecha: s.sequence_date.slice(0, 10),
          piezas,
          conCta,
          respuestas: suma('replies'),
          // Alcance de la secuencia = el de su primera pieza: las siguientes las ve un subconjunto.
          alcance: num(piezas[0]?.reach),
          visitas: suma('profile_visits'),
          compartidos: suma('shares'),
          mejor: piezas.reduce<Pieza | null>((b, p) => (!b || num(p.replies) > num(b.replies) ? p : b), null),
        }
      })
      .filter((s) => (soloCta === 'todas' ? true : soloCta === 'cta' ? s.conCta : !s.conCta))
  }, [raw, periodo, soloCta])

  const piezas = useMemo(() => secuencias.flatMap((s) => s.piezas), [secuencias])

  const rankingPiezas = useMemo(
    () =>
      piezas
        // Con alcance muy chico la tasa se dispara por una sola respuesta.
        .filter((p) => (metrica === 'tasa' ? num(p.reach) >= 300 : true))
        .sort((a, b) => valorPieza(b, metrica) - valorPieza(a, metrica))
        .slice(0, TOP),
    [piezas, metrica],
  )
  const rankingSecuencias = useMemo(
    () => [...secuencias].sort((a, b) => valorSecuencia(b, metrica) - valorSecuencia(a, metrica)).slice(0, TOP),
    [secuencias, metrica],
  )

  const kpis = useMemo(() => {
    const total = piezas.reduce((t, p) => t + num(p.replies), 0)
    const ordenadas = [...piezas].sort((a, b) => num(b.replies) - num(a.replies))
    const top10 = ordenadas.slice(0, 10).reduce((t, p) => t + num(p.replies), 0)
    const alcance = secuencias.reduce((t, s) => t + s.alcance, 0)
    const cta = secuencias.filter((s) => s.conCta)
    const sin = secuencias.filter((s) => !s.conCta)
    const prom = (xs: Secuencia[]) => (xs.length ? xs.reduce((t, s) => t + s.respuestas, 0) / xs.length : 0)
    return {
      total,
      piezas: piezas.length,
      secuencias: secuencias.length,
      porPieza: piezas.length ? total / piezas.length : 0,
      tasa: tasa(secuencias.reduce((t, s) => t + s.respuestas, 0), alcance),
      concentracion: total ? (top10 / total) * 100 : 0,
      promCta: prom(cta),
      promSin: prom(sin),
      nCta: cta.length,
      nSin: sin.length,
    }
  }, [piezas, secuencias])

  /** Promedio de respuestas por secuencia según el día de la semana (lunes primero). */
  const porDia = useMemo(() => {
    const acc = Array.from({ length: 7 }, () => ({ resp: 0, n: 0 }))
    for (const s of secuencias) {
      const d = diaSemana(s.fecha)
      acc[d].resp += s.respuestas
      acc[d].n += 1
    }
    return [1, 2, 3, 4, 5, 6, 0].map((d) => ({ label: DIAS[d], n: acc[d].n, prom: acc[d].n ? acc[d].resp / acc[d].n : 0 }))
  }, [secuencias])

  /** Dónde caen las respuestas dentro de la secuencia: primera, medio o última pieza. */
  const porLugar = useMemo(() => {
    const grupos = [
      { label: 'Primera pieza', resp: 0, n: 0 },
      { label: 'Del medio', resp: 0, n: 0 },
      { label: 'Última pieza', resp: 0, n: 0 },
    ]
    for (const p of piezas) {
      if (p.totalPiezas < 2) continue
      const g = p.posicion === 1 ? 0 : p.posicion === p.totalPiezas ? 2 : 1
      grupos[g].resp += num(p.replies)
      grupos[g].n += 1
    }
    return grupos.map((g) => ({ ...g, prom: g.n ? g.resp / g.n : 0 }))
  }, [piezas])

  const etiquetaMetrica = METRICAS.find((m) => m.key === metrica)!.label
  const maxPieza = rankingPiezas.length ? valorPieza(rankingPiezas[0], metrica) : 0
  const maxSec = rankingSecuencias.length ? valorSecuencia(rankingSecuencias[0], metrica) : 0
  const maxDia = Math.max(1, ...porDia.map((d) => d.prom))
  const maxLugar = Math.max(1, ...porLugar.map((g) => g.prom))
  const dec = metrica === 'tasa' ? 1 : 0

  if (!ready || loading) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>
  if (error) return <div className="py-12 text-center text-[var(--red)]">{error}</div>

  const chip = (activo: boolean) =>
    `rounded-lg px-3 py-1.5 text-[11px] font-semibold uppercase transition-colors ${
      activo ? 'bg-[var(--accent)] text-white' : 'border border-[var(--border2)] text-[var(--text3)] hover:text-[var(--text)]'
    }`

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

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi label="Respuestas" valor={fmt(kpis.total)} sub={`${fmt(kpis.secuencias)} secuencias · ${fmt(kpis.piezas)} piezas`} />
        <Kpi label="Por pieza" valor={fmt(kpis.porPieza, 1)} sub="respuestas promedio" />
        <Kpi label="C/1.000 de alcance" valor={fmt(kpis.tasa, 1)} sub="respuestas sobre el alcance de la 1ª pieza" />
        <Kpi label="Top 10 piezas" valor={`${fmt(kpis.concentracion, 0)}%`} sub="de todas las respuestas" acento />
        <Kpi
          label="Con CTA vs sin CTA"
          valor={`${fmt(kpis.promCta, 0)} / ${fmt(kpis.promSin, 0)}`}
          sub={`respuestas por secuencia (${kpis.nCta} con · ${kpis.nSin} sin)`}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button type="button" className={chip(vista === 'piezas')} onClick={() => setVista('piezas')}>Piezas</button>
        <button type="button" className={chip(vista === 'secuencias')} onClick={() => setVista('secuencias')}>Secuencias</button>
        <span className="mx-2 h-5 w-px bg-[var(--border2)]" />
        {METRICAS.map((m) => (
          <button key={m.key} type="button" className={chip(metrica === m.key)} onClick={() => setMetrica(m.key)}>
            {m.label}
          </button>
        ))}
        <span className="mx-2 h-5 w-px bg-[var(--border2)]" />
        {(['todas', 'cta', 'sin'] as const).map((c) => (
          <button key={c} type="button" className={chip(soloCta === c)} onClick={() => setSoloCta(c)}>
            {c === 'todas' ? 'Todas' : c === 'cta' ? 'Con CTA' : 'Sin CTA'}
          </button>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="glass-card glass-card--performant p-2">
          {vista === 'piezas' ? (
            rankingPiezas.length === 0 ? (
              <Vacio />
            ) : (
              rankingPiezas.map((p, i) => (
                <Fila
                  key={p.id}
                  pos={i + 1}
                  img={p.image_url}
                  onImg={() => setAbierta(p)}
                  titulo={fechaCorta(p.fecha)}
                  detalle={`Pieza ${p.posicion} de ${p.totalPiezas}${p.posicion === p.totalPiezas && p.totalPiezas > 1 ? ' · última' : ''}`}
                  cta={p.conCta}
                  valor={valorPieza(p, metrica)}
                  max={maxPieza}
                  dec={dec}
                  etiqueta={etiquetaMetrica}
                  extras={[
                    ['resp', num(p.replies)],
                    ['alcance', num(p.reach)],
                    ['perfil', num(p.profile_visits)],
                    ['comp', num(p.shares)],
                  ]}
                />
              ))
            )
          ) : rankingSecuencias.length === 0 ? (
            <Vacio />
          ) : (
            rankingSecuencias.map((s, i) => (
              <Fila
                key={s.id}
                pos={i + 1}
                img={s.mejor?.image_url ?? null}
                onImg={() => s.mejor && setAbierta(s.mejor)}
                titulo={fechaCorta(s.fecha)}
                detalle={`${s.piezas.length} piezas${s.mejor && num(s.mejor.replies) > 0 ? ` · la que más respondieron: #${s.mejor.posicion}` : ''}`}
                cta={s.conCta}
                valor={valorSecuencia(s, metrica)}
                max={maxSec}
                dec={dec}
                etiqueta={etiquetaMetrica}
                extras={[
                  ['resp', s.respuestas],
                  ['alcance', s.alcance],
                  ['perfil', s.visitas],
                  ['comp', s.compartidos],
                ]}
                tira={s.piezas}
                onTira={setAbierta}
              />
            ))
          )}
        </div>

        <div className="flex flex-col gap-6">
          <div className="glass-card glass-card--performant p-5">
            <div className="mb-4 text-[10px] uppercase tracking-wider text-[var(--text3)]">Respuestas por secuencia según el día</div>
            {porDia.map((d) => (
              <Barra key={d.label} label={d.label} valor={d.prom} max={maxDia} nota={`${d.n}`} mejor={d.prom === maxDia && d.n > 0} />
            ))}
          </div>
          <div className="glass-card glass-card--performant p-5">
            <div className="mb-4 text-[10px] uppercase tracking-wider text-[var(--text3)]">Respuestas por pieza según su lugar</div>
            {porLugar.map((g) => (
              <Barra key={g.label} label={g.label} valor={g.prom} max={maxLugar} nota={`${g.n}`} mejor={g.prom === maxLugar && g.n > 0} ancho />
            ))}
          </div>
        </div>
      </div>

      {abierta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" onClick={() => setAbierta(null)}>
          <div className="flex max-h-full items-center gap-6" onClick={(e) => e.stopPropagation()}>
            {abierta.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={resolveMediaUrl(abierta.image_url)} alt="" className="max-h-[85vh] rounded-xl object-contain" />
            ) : (
              <div className="flex h-[60vh] w-[34vh] items-center justify-center rounded-xl bg-[var(--bg3)] text-[var(--text3)]">Sin imagen</div>
            )}
            <div className="min-w-[180px] text-[12px]">
              <div className="text-[14px] font-semibold text-white">{fechaCorta(abierta.fecha)}</div>
              <div className="mb-4 text-zinc-400">Pieza {abierta.posicion} de {abierta.totalPiezas}{abierta.conCta ? ' · CTA' : ''}</div>
              {[
                ['Respuestas', num(abierta.replies)],
                ['Alcance', num(abierta.reach)],
                ['Vistas', num(abierta.views)],
                ['Visitas al perfil', num(abierta.profile_visits)],
                ['Compartidos', num(abierta.shares)],
                ['Navegación', num(abierta.navigation)],
              ].map(([k, v]) => (
                <div key={k as string} className="flex justify-between gap-6 border-b border-white/10 py-1.5 text-zinc-300">
                  <span>{k}</span>
                  <span className="font-mono-num text-white">{fmt(v as number)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Kpi({ label, valor, sub, acento }: { label: string; valor: string; sub: string; acento?: boolean }) {
  return (
    <div className={`glass-card glass-card--performant p-5 ${acento ? 'border-[var(--accent)]' : ''}`}>
      <div className={`text-[10px] uppercase tracking-wider ${acento ? 'text-[var(--accent)]' : 'text-[var(--text3)]'}`}>{label}</div>
      <div className={`font-mono-num mt-1 text-3xl font-bold ${acento ? 'text-[var(--accent)]' : ''}`}>{valor}</div>
      <div className="mt-1 text-[11px] text-[var(--text3)]">{sub}</div>
    </div>
  )
}

function Vacio() {
  return <div className="py-12 text-center text-[12px] text-[var(--text3)]">No hay historias en este período.</div>
}

function Fila(props: {
  pos: number
  img: string | null
  onImg: () => void
  titulo: string
  detalle: string
  cta: boolean
  valor: number
  max: number
  dec: number
  etiqueta: string
  extras: [string, number][]
  tira?: Pieza[]
  onTira?: (p: Pieza) => void
}) {
  const { pos, img, onImg, titulo, detalle, cta, valor, max, dec, etiqueta, extras, tira, onTira } = props
  const podio = pos <= 3
  return (
    <div className="flex items-center gap-4 rounded-lg px-3 py-2.5 hover:bg-[var(--bg3)]">
      <div className={`font-mono-num w-8 shrink-0 text-right text-[15px] font-bold ${podio ? 'text-[var(--accent)]' : 'text-[var(--text3)]'}`}>{pos}</div>
      <button type="button" onClick={onImg} className="h-[72px] w-[41px] shrink-0 overflow-hidden rounded-md bg-[var(--bg3)]">
        {img && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={resolveMediaUrl(img)} alt="" loading="lazy" className="h-full w-full object-cover" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          {titulo}
          {cta && <span className="rounded bg-[var(--accent)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">CTA</span>}
        </div>
        <div className="text-[11px] text-[var(--text3)]">{detalle}</div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--bg4)]">
          <div
            className="h-full origin-left rounded-full bg-[var(--accent)]"
            style={{ transform: `scaleX(${max > 0 ? valor / max : 0})` }}
          />
        </div>
        {tira && onTira && (
          <div className="mt-2 flex gap-1">
            {tira.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onTira(p)}
                title={`#${p.posicion} · ${fmt(num(p.replies))} respuestas`}
                className="relative h-[42px] w-[24px] overflow-hidden rounded bg-[var(--bg3)]"
              >
                {p.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={resolveMediaUrl(p.image_url)} alt="" loading="lazy" className="h-full w-full object-cover opacity-80" />
                )}
                <span className="absolute inset-x-0 bottom-0 bg-black/70 text-center text-[8px] font-semibold text-white">{fmt(num(p.replies))}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="hidden shrink-0 gap-4 text-right text-[11px] text-[var(--text3)] md:flex">
        {extras.map(([k, v]) => (
          <div key={k} className="w-14">
            <div className="font-mono-num text-[12px] text-[var(--text2)]">{fmt(v)}</div>
            <div>{k}</div>
          </div>
        ))}
      </div>
      <div className="w-20 shrink-0 text-right">
        <div className="font-mono-num text-xl font-bold">{fmt(valor, dec)}</div>
        <div className="truncate text-[10px] text-[var(--text3)]" title={etiqueta}>{etiqueta.split(' ')[0].toLowerCase()}</div>
      </div>
    </div>
  )
}

function Barra({ label, valor, max, nota, mejor, ancho }: { label: string; valor: number; max: number; nota: string; mejor: boolean; ancho?: boolean }) {
  return (
    <div className="mb-2.5 flex items-center gap-3 text-[11px]">
      <div className={`${ancho ? 'w-24' : 'w-9'} shrink-0 text-[var(--text2)]`}>{label}</div>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--bg4)]">
        <div
          className={`h-full origin-left rounded-full ${mejor ? 'bg-[var(--accent)]' : 'bg-[var(--text3)]'}`}
          style={{ transform: `scaleX(${max > 0 ? valor / max : 0})` }}
        />
      </div>
      <div className="font-mono-num w-10 shrink-0 text-right text-[var(--text)]">{fmt(valor, 1)}</div>
      <div className="w-6 shrink-0 text-right text-[var(--text3)]" title="secuencias / piezas">{nota}</div>
    </div>
  )
}
