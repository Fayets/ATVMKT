'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMonthContext } from '@/shared/components/app-providers'
import { MonthSelector } from '@/shared/components/month-selector'
import { useToast } from '@/shared/components/toast'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { apiFetch, backendAuthHeaders, formatApiDetail } from '@/lib/api'
import { formatIntegerEsAr } from '@/shared/lib/format-utils'
import {
  leadHasAgenda,
  leadHasShow,
  leadIsCierre,
  type LeadRow,
} from '@/features/leads/services/leads-analytics'
import {
  CLOSE_RATE_OBJETIVO,
  CPA_AGENDA_OBJETIVO,
  ETAPAS,
  ETAPA_POR_ID,
  FREQ_ALERTA,
  FREQ_QUEMADA,
  SALUD_ACCION,
  SALUD_ACCION_DETALLE,
  SHOW_UP_OBJETIVO,
  calcEmbudoAds,
  enriquecerCampana,
  formatFrecuencia,
  formatObjective,
  formatPct,
  formatRoas,
  formatUsd,
  formatUsdCompacto,
  formatEstado,
  type AdsCampaignRow,
  type AdsCampaignsResponse,
  type CampanaEnriquecida,
  type EtapaId,
  type SaludCreativa,
} from '../lib/ads-metrics'
import {
  CampaignThumb,
  EmbudoPaso,
  FrecuenciaGauge,
  NotaPlegable,
  SALUD_COLOR,
  SaludChip,
  StatCard,
  campaignThumbSrc,
  estadoBadgeClass,
  type EstadoBenchmark,
} from './ads-primitives'

type EstadoFiltro = 'all' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED'
type SaludFiltro = 'all' | SaludCreativa
type EtapaFiltro = 'all' | EtapaId

/** Orden de urgencia: primero lo que hay que renovar. */
const PRIORIDAD_SALUD: Record<SaludCreativa, number> = {
  quemada: 0,
  alerta: 1,
  sana: 2,
  'sin-datos': 3,
}

export function AdsPage() {
  const { month, options, setMonth } = useMonthContext()
  const { toast } = useToast()
  const { ready, userId } = useAuthUser()

  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [rows, setRows] = useState<AdsCampaignRow[]>([])
  const [leadsAds, setLeadsAds] = useState<LeadRow[]>([])
  const [leadsError, setLeadsError] = useState(false)
  const [adsRevenue, setAdsRevenue] = useState(0)
  const [totalSpend, setTotalSpend] = useState(0)
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [estadoFilter, setEstadoFilter] = useState<EstadoFiltro>('all')
  const [saludFilter, setSaludFilter] = useState<SaludFiltro>('all')
  const [etapaFilter, setEtapaFilter] = useState<EtapaFiltro>('all')
  const [onlyWithSpend, setOnlyWithSpend] = useState(true)
  const [agruparPorEtapa, setAgruparPorEtapa] = useState(true)

  const apiBase =
    (process.env.NEXT_PUBLIC_BACKEND_URL || '').trim().replace(/\/$/, '') || '/api-backend'

  // ── Carga: campañas (Meta) + leads del mes marcados como "vino de ads" (CRM)
  const fetchAll = useCallback(async () => {
    if (!ready || !userId) return
    setLoading(true)
    try {
      const q = month ? `?month=${encodeURIComponent(month)}` : ''
      const campaignsReq = fetch(`${apiBase}/meta-ads/campaigns${q}`, {
        headers: backendAuthHeaders(),
      })
      const leadsReq = month
        ? apiFetch(`/leads?month=${encodeURIComponent(month)}&include_all=true`)
        : apiFetch('/leads?include_all=true')

      const [campaignsRes, leadsRes] = await Promise.allSettled([campaignsReq, leadsReq])

      // Campañas
      if (campaignsRes.status === 'fulfilled') {
        const res = campaignsRes.value
        const data = (await res.json().catch(() => ({}))) as AdsCampaignsResponse
        if (!res.ok) {
          toast(formatApiDetail(data.detail, 'Error al cargar campañas'))
          setRows([])
          setAdsRevenue(0)
          setTotalSpend(0)
          setLastSyncAt(null)
        } else {
          setRows(Array.isArray(data.campaigns) ? data.campaigns : [])
          setAdsRevenue(Number(data.ads_revenue) || 0)
          setTotalSpend(Number(data.total_spend) || 0)
          setLastSyncAt(data.last_sync_at || null)
        }
      } else {
        setRows([])
      }

      // Leads de ads (fuente de la economía real)
      if (leadsRes.status === 'fulfilled' && leadsRes.value.ok) {
        const data = (await leadsRes.value.json().catch(() => ({}))) as { leads?: LeadRow[] }
        const all = Array.isArray(data.leads) ? data.leads : []
        setLeadsAds(all.filter((l) => Boolean(l.vino_de_ads)))
        setLeadsError(false)
      } else {
        setLeadsAds([])
        setLeadsError(true)
      }
    } finally {
      setLoading(false)
    }
  }, [apiBase, month, ready, toast, userId])

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  const handleSync = async () => {
    if (!userId) {
      toast('Iniciá sesión para sincronizar.')
      return
    }
    setSyncing(true)
    setSyncError(null)
    try {
      const q = month ? `?month=${encodeURIComponent(month)}` : ''
      const res = await fetch(`${apiBase}/meta-ads/sync${q}`, {
        method: 'POST',
        headers: backendAuthHeaders(),
      })
      const data = (await res.json().catch(() => ({}))) as { detail?: unknown; campaigns?: number }
      if (!res.ok) {
        const msg = formatApiDetail(data.detail, 'Error al sincronizar Meta Ads')
        setSyncError(msg)
        toast(msg)
        return
      }
      const n = Number(data.campaigns) || 0
      toast(`Sincronizado: ${n} campaña${n === 1 ? '' : 's'}`)
      await fetchAll()
    } finally {
      setSyncing(false)
    }
  }

  // ── Enriquecimiento: frecuencia, salud creativa, etapa inferida
  const campanas = useMemo(() => rows.map(enriquecerCampana), [rows])

  const filtradas = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return campanas
      .filter((c) => {
        if (estadoFilter !== 'all' && (c.estado || '').toUpperCase() !== estadoFilter) return false
        if (saludFilter !== 'all' && c.salud !== saludFilter) return false
        if (etapaFilter !== 'all' && c.etapa !== etapaFilter) return false
        if (onlyWithSpend && !(Number(c.spend) > 0)) return false
        if (!q) return true
        return (
          (c.nombre || '').toLowerCase().includes(q) ||
          (c.campaign_id || '').toLowerCase().includes(q) ||
          formatObjective(c.objective).toLowerCase().includes(q)
        )
      })
      .sort((a, b) => {
        const p = PRIORIDAD_SALUD[a.salud] - PRIORIDAD_SALUD[b.salud]
        if (p !== 0) return p
        return (b.frecuencia ?? 0) - (a.frecuencia ?? 0)
      })
  }, [campanas, searchQuery, estadoFilter, saludFilter, etapaFilter, onlyWithSpend])

  const filtrosActivos =
    searchQuery.trim() !== '' ||
    estadoFilter !== 'all' ||
    saludFilter !== 'all' ||
    etapaFilter !== 'all' ||
    !onlyWithSpend

  // ── Panel de acción: solo cuenta lo que está al aire y gastando
  const accionables = useMemo(
    () => campanas.filter((c) => c.activa && Number(c.spend) > 0),
    [campanas],
  )
  const conteoSalud = useMemo(() => {
    const base: Record<SaludCreativa, CampanaEnriquecida[]> = {
      quemada: [],
      alerta: [],
      sana: [],
      'sin-datos': [],
    }
    for (const c of accionables) base[c.salud].push(c)
    return base
  }, [accionables])

  // ── Embudo: Meta hasta el click, CRM de ahí en adelante.
  // Se calcula SIEMPRE sobre todas las campañas del mes, nunca sobre el subconjunto
  // filtrado: los leads no son atribuibles a una campaña puntual, así que filtrar el
  // gasto sin poder filtrar el cash daría costos por chat/agenda y un ROAS inventados.
  // Los filtros de abajo son de la tabla, no de la economía.
  const embudo = useMemo(
    () =>
      calcEmbudoAds(campanas, leadsAds, {
        tieneAgenda: (l) => leadHasAgenda(l as LeadRow),
        tieneShow: (l) => leadHasShow(l as LeadRow),
        esCierre: (l) => leadIsCierre(l as LeadRow),
      }),
    [campanas, leadsAds],
  )

  const gastoMostrado = totalSpend > 0 ? totalSpend : embudo.gasto
  const cashMostrado = leadsError ? adsRevenue : embudo.cash

  const clearFilters = () => {
    setSearchQuery('')
    setEstadoFilter('all')
    setSaludFilter('all')
    setEtapaFilter('all')
    setOnlyWithSpend(true)
  }

  const porEtapa = useMemo(() => {
    const map = new Map<EtapaId, CampanaEnriquecida[]>()
    for (const c of filtradas) {
      const arr = map.get(c.etapa) || []
      arr.push(c)
      map.set(c.etapa, arr)
    }
    return ETAPAS.map((e) => ({ etapa: e, campanas: map.get(e.id) || [] })).filter(
      (g) => g.campanas.length > 0,
    )
  }, [filtradas])

  if (!ready || loading) {
    return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>
  }

  if (!userId) {
    return (
      <div className="py-12 text-center text-[var(--text3)]">
        Iniciá sesión para ver el dashboard de ads.
      </div>
    )
  }

  const benchCpaAgenda: EstadoBenchmark =
    embudo.agendas === 0
      ? 'neutro'
      : embudo.costoPorAgenda <= CPA_AGENDA_OBJETIVO
        ? 'bueno'
        : 'malo'
  const benchShowUp: EstadoBenchmark =
    embudo.agendas === 0 ? 'neutro' : embudo.showUpRate >= SHOW_UP_OBJETIVO ? 'bueno' : 'malo'
  const benchCloseRate: EstadoBenchmark =
    embudo.shows === 0 ? 'neutro' : embudo.closeRate >= CLOSE_RATE_OBJETIVO ? 'bueno' : 'malo'
  /** El mes mezcla el modelo DM con campañas de pixel: hay que decirlo, no promediarlo en silencio. */
  const gastoConversion = campanas
    .filter((c) => c.objetivoDeConversion)
    .reduce((s, c) => s + (Number(c.spend) || 0), 0)
  const mezclaModelos = gastoConversion > 0 && gastoConversion < embudo.gasto
  const benchRoas: EstadoBenchmark =
    embudo.roas == null ? 'neutro' : embudo.roas >= 1 ? 'bueno' : 'malo'

  const maxEmbudo = Math.max(embudo.clicks, 1)

  return (
    <div className="pb-10">
      {/* ─────────────────────────── HEADER ─────────────────────────── */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Dashboard <span className="text-[var(--text2)]">de Ads</span>
          </h2>
          <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-[var(--text3)]">
            Ordenado por urgencia creativa. Meta mide hasta el click al perfil; de ahí en adelante
            manda el CRM.
            {lastSyncAt ? ` · Última sync: ${new Date(lastSyncAt).toLocaleString('es-AR')}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MonthSelector month={month} options={options} onChange={setMonth} />
          <button
            type="button"
            onClick={() => void handleSync()}
            disabled={syncing}
            className="inline-flex w-fit items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white shadow-sm hover:opacity-90 disabled:opacity-40"
          >
            {syncing ? 'Sincronizando…' : 'Sincronizar'}
          </button>
        </div>
      </div>

      {syncError ? (
        <div className="mb-6 rounded-xl border border-[rgba(230,57,70,0.35)] bg-[rgba(230,57,70,0.08)] px-4 py-3 text-[12px] leading-relaxed text-[var(--text2)]">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--accent)]">
            Sync Meta Ads
          </div>
          <p className="whitespace-pre-wrap">{syncError}</p>
          <p className="mt-2 text-[11px] text-[var(--text3)]">
            Revisá el token y el Ad Account ID en{' '}
            <a href="/conexiones" className="text-[var(--accent)] underline-offset-2 hover:underline">
              Conexiones API → Meta Ads
            </a>
            . El token necesita <span className="text-[var(--text2)]">ads_read</span>.
          </p>
        </div>
      ) : null}

      {/* ───────────────────── 1. QUÉ HACER HOY ───────────────────── */}
      <section className="mb-8">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <div className="text-[11px] font-medium uppercase tracking-widest text-[var(--text3)]">
            Qué hacer hoy
          </div>
          <div className="text-[10px] text-[var(--text3)]">
            Frecuencia = impresiones / alcance · umbrales del módulo: {FREQ_ALERTA} / {FREQ_QUEMADA}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <AccionCard
            salud="quemada"
            titulo="Renovar creativo"
            campanas={conteoSalud.quemada}
            onVer={() => {
              setSaludFilter('quemada')
              setOnlyWithSpend(true)
              setEstadoFilter('ACTIVE')
            }}
          />
          <AccionCard
            salud="alerta"
            titulo="Preparar reemplazo"
            campanas={conteoSalud.alerta}
            onVer={() => {
              setSaludFilter('alerta')
              setOnlyWithSpend(true)
              setEstadoFilter('ACTIVE')
            }}
          />
          <AccionCard
            salud="sana"
            titulo="Candidatas a escalar"
            campanas={conteoSalud.sana}
            onVer={() => {
              setSaludFilter('sana')
              setOnlyWithSpend(true)
              setEstadoFilter('ACTIVE')
            }}
          />
        </div>

        {conteoSalud['sin-datos'].length > 0 ? (
          <p className="mt-2 text-[10px] text-[var(--text3)]">
            {conteoSalud['sin-datos'].length} campaña
            {conteoSalud['sin-datos'].length === 1 ? '' : 's'} activa
            {conteoSalud['sin-datos'].length === 1 ? '' : 's'} sin alcance registrado — no se puede
            calcular su frecuencia.
          </p>
        ) : null}
      </section>

      {/* ───────────────────── 2. ECONOMÍA REAL ───────────────────── */}
      <section className="mb-8">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-[11px] font-medium uppercase tracking-widest text-[var(--text3)]">
            Economía real del mes
          </div>
          <div className="text-[10px] text-[var(--text3)]">
            Chats, agendas y cierres salen de leads marcados <code>vino_de_ads</code> en el CRM
          </div>
        </div>

        <div className="glass-card accent-top relative mb-3 flex flex-wrap items-start gap-8 p-6 lg:gap-14">
          <div>
            <div className="text-[11px] text-[var(--text3)]">Gasto</div>
            <div className="font-mono-num mt-1 text-3xl font-bold leading-none">
              {formatUsdCompacto(gastoMostrado)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[var(--text3)]">Cash de ads</div>
            <div className="font-mono-num mt-1 text-3xl font-bold leading-none text-[var(--green)]">
              {formatUsdCompacto(cashMostrado)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[var(--text3)]">ROAS</div>
            <div
              className="font-mono-num mt-1 text-3xl font-bold leading-none"
              style={{
                color:
                  benchRoas === 'bueno'
                    ? 'var(--green)'
                    : benchRoas === 'malo'
                      ? 'var(--accent)'
                      : 'var(--text)',
              }}
            >
              {formatRoas(embudo.roas)}
            </div>
          </div>
          <div className="ml-auto max-w-[300px] text-right text-[10px] leading-relaxed text-[var(--text3)]">
            El embudo tarda semanas: el cash de este mes viene en parte del gasto de los meses
            anteriores. Leé el ROAS mensual como tendencia, no como veredicto.
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <StatCard
            label="Costo por chat"
            value={embudo.chats > 0 ? formatUsd(embudo.costoPorChat) : 'No medido'}
            sub={
              embudo.fuenteChats === 'crm'
                ? `${formatIntegerEsAr(embudo.chats)} chats · CRM`
                : embudo.fuenteChats === 'meta'
                  ? `${formatIntegerEsAr(embudo.chats)} conversaciones · Meta`
                  : 'el CRM tilda vino_de_ads recién al agendar'
            }
            hint={
              embudo.fuenteChats === 'meta'
                ? 'El CRM solo marca vino_de_ads en leads que ya agendaron, así que el chat se toma de las conversaciones de DM que reporta Meta.'
                : 'Gasto ÷ chats de ads previos a la agenda.'
            }
          />
          <StatCard
            label="CPA agenda"
            value={embudo.agendas > 0 ? formatUsd(embudo.costoPorAgenda) : '—'}
            sub={`${formatIntegerEsAr(embudo.agendas)} agendas`}
            benchmark={`obj < $${CPA_AGENDA_OBJETIVO}`}
            estado={benchCpaAgenda}
            hint="KPI ATV: agenda calificada por debajo de $50."
          />
          <StatCard
            label="Costo por show"
            value={embudo.shows > 0 ? formatUsd(embudo.costoPorShow) : '—'}
            sub={`${formatIntegerEsAr(embudo.shows)} shows`}
          />
          <StatCard
            label="Show up rate"
            value={embudo.agendas > 0 ? formatPct(embudo.showUpRate) : '—'}
            sub={`${formatIntegerEsAr(embudo.noShows)} no show`}
            benchmark={`obj > ${SHOW_UP_OBJETIVO}%`}
            estado={benchShowUp}
          />
          <StatCard
            label="Close rate"
            value={embudo.shows > 0 ? formatPct(embudo.closeRate) : '—'}
            sub={
              embudo.ventas !== embudo.cierresStatus
                ? `${formatIntegerEsAr(embudo.ventas)} cobraron · ${formatIntegerEsAr(embudo.cierresStatus)} con status Cerrado`
                : `${formatIntegerEsAr(embudo.ventas)} ventas`
            }
            benchmark={`obj > ${CLOSE_RATE_OBJETIVO}%`}
            estado={benchCloseRate}
            hint="Se cuenta como venta el lead que cobró algo (payment > 0), no el status: en la práctica el status queda desactualizado."
          />
          <StatCard
            label="CAC (costo por venta)"
            value={embudo.ventas > 0 ? formatUsd(embudo.costoPorVenta) : '—'}
            sub={
              embudo.ventas > 0
                ? `ticket prom. ${formatUsd(embudo.ticketPromedio)}`
                : 'sin cobros en el período'
            }
          />
        </div>

        {leadsError ? (
          <p className="mt-2 text-[10px] text-[var(--amber)]">
            No se pudieron traer los leads del CRM: las métricas de chat/agenda/cierre quedan en
            cero y el cash cae al valor que devuelve el backend.
          </p>
        ) : null}
      </section>

      {/* ───────────────────── 3. EMBUDO ───────────────────── */}
      <section className="mb-8">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-[11px] font-medium uppercase tracking-widest text-[var(--text3)]">
            Embudo de ads
          </div>
          <div className="flex items-center gap-4 text-[10px] text-[var(--text3)]">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-1 w-1 rounded-full bg-[var(--text3)]" /> Meta
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-1 w-1 rounded-full bg-[var(--green)]" /> CRM
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border2)] bg-[var(--bg2)] p-5">
          <div className="flex flex-wrap items-end gap-2 sm:flex-nowrap">
            <EmbudoPaso
              label="Alcance"
              valor={formatIntegerEsAr(embudo.alcance)}
              costo={`freq ${formatFrecuencia(embudo.frecuenciaPonderada)}`}
              intensidad={1}
              fuente="meta"
            />
            <EmbudoPaso
              label="Clicks al perfil"
              valor={formatIntegerEsAr(embudo.clicks)}
              costo={embudo.clicks > 0 ? formatUsd(embudo.costoPorClick) : undefined}
              tasa={embudo.alcance > 0 ? formatPct((embudo.clicks / embudo.alcance) * 100, 2) : undefined}
              intensidad={0.82}
              fuente="meta"
            />
            <EmbudoPaso
              label={embudo.fuenteChats === 'meta' ? 'Chats (DM)' : 'Chats'}
              valor={
                embudo.fuenteChats === 'no-medido' ? 'n/d' : formatIntegerEsAr(embudo.chats)
              }
              costo={embudo.chats > 0 ? formatUsd(embudo.costoPorChat) : undefined}
              tasa={
                embudo.clicks > 0 && embudo.chats > 0
                  ? formatPct(embudo.tasaChat, 2)
                  : undefined
              }
              intensidad={0.6 * Math.min(1, embudo.chats / maxEmbudo) + 0.25}
              fuente={embudo.fuenteChats === 'crm' ? 'crm' : 'meta'}
            />
            <EmbudoPaso
              label="Agendas"
              valor={formatIntegerEsAr(embudo.agendas)}
              costo={embudo.agendas > 0 ? formatUsd(embudo.costoPorAgenda) : undefined}
              tasa={embudo.chats > 0 ? formatPct(embudo.tasaAgenda) : undefined}
              intensidad={0.42}
              fuente="crm"
            />
            <EmbudoPaso
              label="Shows"
              valor={formatIntegerEsAr(embudo.shows)}
              costo={embudo.shows > 0 ? formatUsd(embudo.costoPorShow) : undefined}
              tasa={embudo.agendas > 0 ? formatPct(embudo.showUpRate) : undefined}
              intensidad={0.3}
              fuente="crm"
            />
            <EmbudoPaso
              label="Ventas"
              valor={formatIntegerEsAr(embudo.ventas)}
              costo={embudo.ventas > 0 ? formatUsd(embudo.costoPorVenta) : undefined}
              tasa={embudo.shows > 0 ? formatPct(embudo.closeRate) : undefined}
              intensidad={0.18}
              fuente="crm"
            />
          </div>
          <p className="mt-4 text-[10px] leading-relaxed text-[var(--text3)]">
            El salto de &quot;clicks al perfil&quot; a &quot;chats&quot; es donde actúa el tercer
            filtro del módulo: tu perfil (destacadas, bio, CTA). Si ahí se cae mucho, el problema no
            está en la campaña.
          </p>

          {mezclaModelos ? (
            <div className="mt-4 border-t border-[var(--border)] pt-4">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-widest text-[var(--text3)]">
                Ojo con este embudo
              </div>
              <p className="text-[10px] leading-relaxed text-[var(--amber)]">
                {formatUsd(gastoConversion)} de los {formatUsd(embudo.gasto)} del mes (
                {formatPct((gastoConversion / embudo.gasto) * 100, 0)}) están en campañas con
                objetivo de conversión, que corren con pixel y landing — no con DM. Ese gasto entra
                en los costos unitarios de arriba pero su tráfico no pasa por este embudo, así que
                el CPA de agenda y el CAC quedan sobreestimados. Filtrá por etapa en la tabla para
                verlas por separado.
              </p>
            </div>
          ) : null}
        </div>
      </section>

      {/* ───────────────────── 4. CAMPAÑAS ───────────────────── */}
      <section>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-[11px] font-medium uppercase tracking-widest text-[var(--text3)]">
            Campañas
          </div>
          <div className="text-[10px] text-[var(--text3)]">
            {filtradas.length} de {campanas.length} · ordenadas por urgencia creativa · los filtros
            afectan solo esta tabla
          </div>
        </div>

        {/* Filtros */}
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border2)] bg-[var(--bg2)] p-3 sm:gap-3">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar campaña…"
            aria-label="Buscar campaña"
            className="w-full min-w-[150px] flex-1 rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--text3)] focus:border-[var(--text3)] sm:max-w-[200px]"
          />
          <select
            value={saludFilter}
            onChange={(e) => setSaludFilter(e.target.value as SaludFiltro)}
            aria-label="Filtrar por salud creativa"
            className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[12px] text-[var(--text)] outline-none"
          >
            <option value="all">Toda salud creativa</option>
            <option value="quemada">Quemada (≥ 1,6)</option>
            <option value="alerta">Alerta (1,4–1,6)</option>
            <option value="sana">Sana (&lt; 1,4)</option>
            <option value="sin-datos">Sin datos</option>
          </select>
          <select
            value={etapaFilter}
            onChange={(e) => setEtapaFilter(e.target.value as EtapaFiltro)}
            aria-label="Filtrar por etapa"
            className="max-w-[190px] rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[12px] text-[var(--text)] outline-none"
          >
            <option value="all">Todas las etapas</option>
            {ETAPAS.map((e) => (
              <option key={e.id} value={e.id}>
                {e.numero === '—' ? e.nombre : `${e.numero}. ${e.nombre}`}
              </option>
            ))}
          </select>
          <select
            value={estadoFilter}
            onChange={(e) => setEstadoFilter(e.target.value as EstadoFiltro)}
            aria-label="Filtrar por estado"
            className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[12px] text-[var(--text)] outline-none"
          >
            <option value="all">Todos los estados</option>
            <option value="ACTIVE">Active</option>
            <option value="PAUSED">Paused</option>
            <option value="ARCHIVED">Archived</option>
          </select>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[12px] text-[var(--text2)]">
            <input
              type="checkbox"
              checked={onlyWithSpend}
              onChange={(e) => setOnlyWithSpend(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            Solo con gasto
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[12px] text-[var(--text2)]">
            <input
              type="checkbox"
              checked={agruparPorEtapa}
              onChange={(e) => setAgruparPorEtapa(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            Agrupar por etapa
          </label>
          {filtrosActivos ? (
            <button
              type="button"
              onClick={clearFilters}
              className="text-[11px] font-medium text-[var(--accent)] underline-offset-2 hover:underline"
            >
              Limpiar
            </button>
          ) : null}
        </div>

        {filtradas.length === 0 ? (
          <div className="rounded-2xl border border-[var(--border2)] bg-[var(--bg2)] px-4 py-12 text-center text-[13px] text-[var(--text3)]">
            {campanas.length === 0 ? (
              syncError ? (
                <>
                  No se pudieron traer campañas. Tocá{' '}
                  <span className="text-[var(--text2)]">Sincronizar</span> de nuevo o corregí el
                  token en Conexiones.
                </>
              ) : (
                <>
                  No hay campañas para este mes. Configurá Meta Ads en Conexiones API y tocá{' '}
                  <span className="text-[var(--text2)]">Sincronizar</span>.
                </>
              )
            ) : (
              <>
                Ninguna campaña coincide con los filtros.{' '}
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-[var(--accent)] underline-offset-2 hover:underline"
                >
                  Limpiar filtros
                </button>
              </>
            )}
          </div>
        ) : agruparPorEtapa ? (
          <div className="space-y-5">
            {porEtapa.map(({ etapa, campanas: grupo }) => (
              <div key={etapa.id}>
                <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-[12px] font-semibold text-[var(--text)]">
                    {etapa.numero === '—' ? etapa.nombre : `Etapa ${etapa.numero} · ${etapa.nombre}`}
                  </span>
                  <span className="text-[10px] text-[var(--text3)]">{etapa.descripcion}</span>
                  <span className="font-mono-num ml-auto text-[11px] tabular-nums text-[var(--text2)]">
                    {formatUsd(grupo.reduce((s, c) => s + (Number(c.spend) || 0), 0))}
                  </span>
                </div>
                <TablaCampanas campanas={grupo} />
              </div>
            ))}
          </div>
        ) : (
          <TablaCampanas campanas={filtradas} />
        )}
      </section>

      {/* ───────────────────── 5. METODOLOGÍA ───────────────────── */}
      <section className="mt-8">
        <NotaPlegable titulo="Por qué este dashboard mide así">
          <p>
            <strong className="text-[var(--text)]">La frecuencia manda.</strong> Es la única métrica
            del módulo con umbral numérico y acción asociada: máximo {FREQ_ALERTA}, y en{' '}
            {FREQ_QUEMADA} el creativo ya está quemado. Cuando se pasa, Meta pierde el aprendizaje y
            sale a buscar un mercado más barato — de ahí vienen los leads descalificados. Por eso la
            tabla se ordena por urgencia creativa y no por gasto.
          </p>
          <p>
            <strong className="text-[var(--text)]">No mostramos conversiones de Meta.</strong> Las
            campañas del modelo son de objetivo &quot;Tráfico&quot; hacia Follow Me Ads o DM: sin
            pixel, sin landing, sin evento de conversión. Meta devuelve cero y ese cero no significa
            nada. La conversión real es el chat, y esa vive en el CRM.
          </p>
          <p>
            <strong className="text-[var(--text)]">CTR y CPC quedan como contexto.</strong> En Follow
            Me Ads el click es click-al-perfil: barato, abundante y sin correlación con lead
            calificado. Optimizar por CPC bajo te lleva justo al mercado barato contra el que
            advierte el módulo de escalado.
          </p>
          <p>
            <strong className="text-[var(--text)]">Escalar es horizontal.</strong> Una campaña sana
            no se escala subiéndole el presupuesto: se duplica en un conjunto nuevo con el doble de
            presupuesto, dejando la original intacta. Por eso las campañas sanas figuran como
            &quot;candidatas a escalar&quot; y no como &quot;subir presupuesto&quot;.
          </p>
          <p>
            <strong className="text-[var(--text)]">Dos límites conocidos.</strong> (1) La etapa se
            infiere del nombre de la campaña, porque las cuatro usan el mismo objetivo — si cae en
            &quot;Sin clasificar&quot;, nombrá la campaña con la etapa adelante. (2) La frecuencia
            del total es aproximada: el alcance no se puede deduplicar entre campañas. La frecuencia
            por campaña sí es exacta.
          </p>
        </NotaPlegable>
      </section>
    </div>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TARJETA DE ACCIÓN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function AccionCard({
  salud,
  titulo,
  campanas,
  onVer,
}: {
  salud: SaludCreativa
  titulo: string
  campanas: CampanaEnriquecida[]
  onVer: () => void
}) {
  const color = SALUD_COLOR[salud]
  const n = campanas.length
  const gasto = campanas.reduce((s, c) => s + (Number(c.spend) || 0), 0)
  const vacio = n === 0

  return (
    <div
      className="relative overflow-hidden rounded-xl border bg-[var(--bg2)] p-4"
      style={{
        borderColor: vacio ? 'var(--border2)' : `color-mix(in srgb, ${color} 34%, transparent)`,
        background: vacio ? 'var(--bg2)' : `color-mix(in srgb, ${color} 5%, var(--bg2))`,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ background: vacio ? 'var(--text3)' : color }}
              aria-hidden
            />
            <span className="text-[12px] font-semibold text-[var(--text)]">{titulo}</span>
          </div>
          <div className="font-mono-num mt-2 text-3xl font-bold leading-none" style={{ color: vacio ? 'var(--text3)' : color }}>
            {n}
          </div>
          <div className="mt-1 text-[10px] text-[var(--text3)]">
            {vacio
              ? 'ninguna campaña activa acá'
              : `${formatUsd(gasto)} en juego · ${n === 1 ? 'campaña activa' : 'campañas activas'}`}
          </div>
        </div>
        {!vacio ? (
          <button
            type="button"
            onClick={onVer}
            className="shrink-0 rounded-md border border-[var(--border2)] px-2 py-1 text-[10px] font-medium text-[var(--text2)] hover:border-[var(--text3)] hover:text-[var(--text)]"
          >
            Ver
          </button>
        ) : null}
      </div>

      {!vacio ? (
        <ul className="mt-3 space-y-1 border-t border-[var(--border)] pt-3">
          {campanas.slice(0, 3).map((c) => (
            <li key={c.id} className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="truncate text-[var(--text2)]" title={c.nombre || c.campaign_id}>
                {c.nombre || c.campaign_id}
              </span>
              <span className="font-mono-num shrink-0 tabular-nums" style={{ color }}>
                {formatFrecuencia(c.frecuencia)}
              </span>
            </li>
          ))}
          {n > 3 ? (
            <li className="text-[10px] text-[var(--text3)]">+{n - 3} más</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TABLA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function TablaCampanas({ campanas }: { campanas: CampanaEnriquecida[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-[var(--border2)] bg-[var(--bg2)]">
      <table className="w-full min-w-[1020px] border-collapse text-left text-[13px]">
        <thead>
          <tr className="border-b border-[var(--border)] bg-[var(--bg3)]">
            <th className="px-4 py-3 font-semibold text-[var(--text2)]">Campaña</th>
            <th className="px-4 py-3 font-semibold text-[var(--text2)]">Frecuencia</th>
            <th className="px-4 py-3 font-semibold text-[var(--text2)]">Acción</th>
            <th className="px-4 py-3 text-right font-semibold text-[var(--text2)]">Gasto</th>
            <th className="px-4 py-3 text-right font-semibold text-[var(--text2)]">Alcance</th>
            <th className="px-4 py-3 text-right font-semibold text-[var(--text2)]">Impresiones</th>
            <th className="px-4 py-3 text-right font-semibold text-[var(--text2)]">Clicks</th>
            <th className="px-4 py-3 text-right font-semibold text-[var(--text2)]">CPM</th>
            <th className="px-4 py-3 text-right font-semibold text-[var(--text2)]">CPC</th>
            <th className="px-4 py-3 font-semibold text-[var(--text2)]">Estado</th>
          </tr>
        </thead>
        <tbody>
          {campanas.map((c) => {
            const objective = formatObjective(c.objective)
            const urgente = c.activa && c.salud === 'quemada'
            return (
              <tr
                key={c.id}
                className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg3)]/40"
                style={
                  urgente
                    ? { background: 'color-mix(in srgb, var(--accent) 5%, transparent)' }
                    : undefined
                }
              >
                <td className="px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <CampaignThumb
                      src={campaignThumbSrc(c.thumbnail_url)}
                      alt={c.nombre || c.campaign_id}
                    />
                    <div className="min-w-0">
                      <div
                        className="truncate font-medium text-[var(--text)]"
                        title={c.nombre || c.campaign_id}
                      >
                        {c.nombre || c.campaign_id}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        {objective ? (
                          <span className="truncate text-[11px] text-[var(--text3)]">{objective}</span>
                        ) : null}
                        <span className="truncate text-[10px] text-[var(--text3)]">
                          {ETAPA_POR_ID[c.etapa].chip}
                        </span>
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="font-mono-num w-[34px] shrink-0 text-right text-[13px] font-semibold tabular-nums"
                      style={{ color: SALUD_COLOR[c.salud] }}
                    >
                      {formatFrecuencia(c.frecuencia)}
                    </span>
                    <FrecuenciaGauge frecuencia={c.frecuencia} salud={c.salud} compact />
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div title={SALUD_ACCION_DETALLE[c.salud]}>
                    <SaludChip salud={c.salud} />
                    <div className="mt-1 whitespace-nowrap text-[10px] text-[var(--text3)]">
                      {c.activa ? SALUD_ACCION[c.salud] : 'Pausada'}
                    </div>
                  </div>
                </td>
                <td className="font-mono-num px-4 py-3 text-right tabular-nums">
                  {formatUsd(c.spend)}
                </td>
                <td className="font-mono-num px-4 py-3 text-right tabular-nums text-[var(--text2)]">
                  {formatIntegerEsAr(c.reach)}
                </td>
                <td className="font-mono-num px-4 py-3 text-right tabular-nums text-[var(--text2)]">
                  {formatIntegerEsAr(c.impressions)}
                </td>
                <td className="font-mono-num px-4 py-3 text-right tabular-nums text-[var(--text2)]">
                  {formatIntegerEsAr(c.clicks)}
                </td>
                <td className="font-mono-num px-4 py-3 text-right tabular-nums text-[var(--text3)]">
                  {c.impressions > 0 ? formatUsd(c.cpm) : '—'}
                </td>
                <td className="font-mono-num px-4 py-3 text-right tabular-nums text-[var(--text3)]">
                  {c.clicks > 0 ? formatUsd(c.cpc) : '—'}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${estadoBadgeClass(c.estado)}`}
                  >
                    {formatEstado(c.estado)}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
