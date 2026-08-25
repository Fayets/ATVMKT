'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMonthContext } from '@/shared/components/app-providers'
import { MonthSelector } from '@/shared/components/month-selector'
import { useToast } from '@/shared/components/toast'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { backendAuthHeaders, formatApiDetail } from '@/lib/api'
import { formatIntegerEsAr } from '@/shared/lib/format-utils'
import { Bar, Doughnut } from '@/shared/components/charts'

type AdsCampaignRow = {
  id: number
  campaign_id: string
  nombre: string
  estado: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  cost_per_conversion: number
  reach: number
  roas: number | null
}

type AdsCampaignsResponse = {
  campaigns?: AdsCampaignRow[]
  ads_revenue?: number
  total_spend?: number
  roas?: number | null
  last_sync_at?: string | null
  detail?: unknown
}

const CHART_COLORS = ['#F59E0B', '#3B82F6', '#22C55E', '#A855F7', '#EF4444', '#FB923C', '#06B6D4', '#EC4899']

function formatUsd(n: number): string {
  return `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatRoas(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`
}

function formatEstado(raw: string): string {
  const s = (raw || '').trim()
  if (!s) return '—'
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase().replace(/_/g, ' ')
}

function formatPct(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return `${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
}

export default function AdsPage() {
  const { month, options, setMonth } = useMonthContext()
  const { toast } = useToast()
  const { ready, userId } = useAuthUser()

  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [rows, setRows] = useState<AdsCampaignRow[]>([])
  const [adsRevenue, setAdsRevenue] = useState(0)
  const [totalSpend, setTotalSpend] = useState(0)
  const [overallRoas, setOverallRoas] = useState<number | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)

  const apiBase =
    (process.env.NEXT_PUBLIC_BACKEND_URL || '').trim().replace(/\/$/, '') || '/api-backend'

  const fetchCampaigns = useCallback(async () => {
    if (!ready || !userId) return
    setLoading(true)
    try {
      const q = month ? `?month=${encodeURIComponent(month)}` : ''
      const res = await fetch(`${apiBase}/meta-ads/campaigns${q}`, {
        headers: backendAuthHeaders(),
      })
      const data = (await res.json().catch(() => ({}))) as AdsCampaignsResponse
      if (!res.ok) {
        toast(formatApiDetail(data.detail, 'Error al cargar campañas'))
        setRows([])
        setAdsRevenue(0)
        setTotalSpend(0)
        setOverallRoas(null)
        setLastSyncAt(null)
        return
      }
      setRows(Array.isArray(data.campaigns) ? data.campaigns : [])
      setAdsRevenue(Number(data.ads_revenue) || 0)
      setTotalSpend(Number(data.total_spend) || 0)
      setOverallRoas(data.roas == null ? null : Number(data.roas))
      setLastSyncAt(data.last_sync_at || null)
    } finally {
      setLoading(false)
    }
  }, [apiBase, month, ready, toast, userId])

  useEffect(() => {
    void fetchCampaigns()
  }, [fetchCampaigns])

  const handleSync = async () => {
    if (!userId) {
      toast('Iniciá sesión para sincronizar.')
      return
    }
    setSyncing(true)
    try {
      const q = month ? `?month=${encodeURIComponent(month)}` : ''
      const res = await fetch(`${apiBase}/meta-ads/sync${q}`, {
        method: 'POST',
        headers: backendAuthHeaders(),
      })
      const data = (await res.json().catch(() => ({}))) as {
        detail?: unknown
        created?: number
        updated?: number
        campaigns?: number
      }
      if (!res.ok) {
        toast(formatApiDetail(data.detail, 'Error al sincronizar Meta Ads'))
        return
      }
      const n = Number(data.campaigns) || 0
      toast(`Sincronizado: ${n} campaña${n === 1 ? '' : 's'}`)
      await fetchCampaigns()
    } finally {
      setSyncing(false)
    }
  }

  const totals = useMemo(() => {
    const impressions = rows.reduce((s, r) => s + (Number(r.impressions) || 0), 0)
    const clicks = rows.reduce((s, r) => s + (Number(r.clicks) || 0), 0)
    const conversions = rows.reduce((s, r) => s + (Number(r.conversions) || 0), 0)
    const reach = rows.reduce((s, r) => s + (Number(r.reach) || 0), 0)
    const active = rows.filter((r) => (r.estado || '').toUpperCase() === 'ACTIVE').length
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0
    const cpc = clicks > 0 ? totalSpend / clicks : 0
    const cpa = conversions > 0 ? totalSpend / conversions : 0
    return { impressions, clicks, conversions, reach, active, ctr, cpc, cpa }
  }, [rows, totalSpend])

  const chartRows = useMemo(() => rows.filter((r) => r.spend > 0).slice(0, 8), [rows])

  if (!ready || loading) {
    return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>
  }

  if (!userId) {
    return <div className="py-12 text-center text-[var(--text3)]">Iniciá sesión para ver el dashboard de ads.</div>
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Dashboard <span className="text-[var(--text2)]">de Ads</span>
          </h2>
          <p className="mt-1 text-[12px] text-[var(--text3)]">
            ROAS = ingresos de leads con ads del mes / gasto.
            {lastSyncAt ? ` Última sync: ${new Date(lastSyncAt).toLocaleString('es-AR')}` : ''}
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

      <div className="mb-6 glass-card relative flex flex-wrap items-center justify-between gap-6 p-6 accent-top">
        <div className="flex flex-wrap items-start gap-8 lg:gap-12">
          <div>
            <div className="text-[11px] text-[var(--text3)]">Gasto</div>
            <div className="font-mono-num mt-1 text-3xl font-bold leading-none">{formatUsd(totalSpend)}</div>
          </div>
          <div>
            <div className="text-[11px] text-[var(--text3)]">Ingresos ads</div>
            <div className="font-mono-num mt-1 text-3xl font-bold leading-none text-[var(--green)]">
              {formatUsd(adsRevenue)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[var(--text3)]">ROAS</div>
            <div className="font-mono-num mt-1 text-3xl font-bold leading-none">{formatRoas(overallRoas)}</div>
          </div>
        </div>
        <div className="text-right text-[12px] text-[var(--text3)]">
          {rows.length} campaña{rows.length === 1 ? '' : 's'} · {totals.active} activa{totals.active === 1 ? '' : 's'}
        </div>
      </div>

      <div className="mb-2 text-[11px] font-medium uppercase tracking-widest text-[var(--text3)]">
        Métricas del mes
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <div className="glass-card p-4">
          <div className="text-[11px] tracking-tight text-[var(--text3)]">Impresiones</div>
          <div className="font-mono-num mt-1 text-2xl font-bold">{formatIntegerEsAr(totals.impressions)}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-[11px] tracking-tight text-[var(--text3)]">Clicks</div>
          <div className="font-mono-num mt-1 text-2xl font-bold">{formatIntegerEsAr(totals.clicks)}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-[11px] tracking-tight text-[var(--text3)]">CTR</div>
          <div className="font-mono-num mt-1 text-2xl font-bold">{formatPct(totals.ctr)}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-[11px] tracking-tight text-[var(--text3)]">Conversiones</div>
          <div className="font-mono-num mt-1 text-2xl font-bold">{formatIntegerEsAr(totals.conversions)}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-[11px] tracking-tight text-[var(--text3)]">CPC</div>
          <div className="font-mono-num mt-1 text-2xl font-bold">{formatUsd(totals.cpc)}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-[11px] tracking-tight text-[var(--text3)]">Costo / conv.</div>
          <div className="font-mono-num mt-1 text-2xl font-bold">{formatUsd(totals.cpa)}</div>
        </div>
      </div>

      {chartRows.length > 0 ? (
        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
          <div className="glass-card p-5">
            <div className="mb-4 text-[11px] font-medium uppercase tracking-widest text-[var(--text3)]">
              Gasto por campaña
            </div>
            <div className="h-56">
              <Bar
                data={{
                  labels: chartRows.map((r) => r.nombre || r.campaign_id),
                  datasets: [
                    {
                      data: chartRows.map((r) => r.spend),
                      backgroundColor: CHART_COLORS.slice(0, chartRows.length),
                      borderRadius: 6,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      callbacks: {
                        label: (ctx) => formatUsd(Number(ctx.raw) || 0),
                      },
                    },
                  },
                  scales: {
                    x: {
                      ticks: {
                        maxRotation: 0,
                        autoSkip: true,
                        callback(value) {
                          const label = this.getLabelForValue(Number(value))
                          return label.length > 14 ? `${label.slice(0, 14)}…` : label
                        },
                      },
                      grid: { display: false },
                    },
                    y: {
                      ticks: {
                        callback: (v) => `$${Number(v).toLocaleString('es-AR')}`,
                      },
                    },
                  },
                }}
              />
            </div>
          </div>
          <div className="glass-card p-5">
            <div className="mb-4 text-[11px] font-medium uppercase tracking-widest text-[var(--text3)]">
              Share de gasto
            </div>
            <div className="mx-auto h-44 w-44">
              <Doughnut
                data={{
                  labels: chartRows.map((r) => r.nombre || r.campaign_id),
                  datasets: [
                    {
                      data: chartRows.map((r) => r.spend),
                      backgroundColor: CHART_COLORS.slice(0, chartRows.length),
                      borderWidth: 0,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  cutout: '62%',
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      callbacks: {
                        label: (ctx) => {
                          const v = Number(ctx.raw) || 0
                          const pct = totalSpend > 0 ? (v / totalSpend) * 100 : 0
                          return `${formatUsd(v)} (${pct.toFixed(0)}%)`
                        },
                      },
                    },
                  },
                }}
              />
            </div>
            <div className="mt-3 space-y-1.5">
              {chartRows.slice(0, 4).map((r, i) => (
                <div key={r.id} className="flex items-center gap-2 text-[11px]">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[var(--text2)]">{r.nombre || r.campaign_id}</span>
                  <span className="font-mono-num shrink-0 text-[var(--text3)]">
                    {totalSpend > 0 ? `${((r.spend / totalSpend) * 100).toFixed(0)}%` : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="mb-2 text-[11px] font-medium uppercase tracking-widest text-[var(--text3)]">Campañas</div>
      <div className="overflow-x-auto rounded-2xl border border-[var(--border2)] bg-[var(--bg2)]">
        <table className="w-full min-w-[860px] border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--bg3)]">
              <th className="px-4 py-3 font-semibold text-[var(--text2)]">Campaña</th>
              <th className="px-4 py-3 font-semibold text-[var(--text2)]">Estado</th>
              <th className="px-4 py-3 text-right font-semibold text-[var(--text2)]">Gasto ($)</th>
              <th className="px-4 py-3 text-right font-semibold text-[var(--text2)]">Impresiones</th>
              <th className="px-4 py-3 text-right font-semibold text-[var(--text2)]">Clicks</th>
              <th className="px-4 py-3 text-right font-semibold text-[var(--text2)]">Conversiones</th>
              <th className="px-4 py-3 text-right font-semibold text-[var(--text2)]">Costo por conversión ($)</th>
              <th className="px-4 py-3 text-right font-semibold text-[var(--text2)]">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-[var(--text3)]">
                  No hay campañas para este mes. Configurá Meta Ads en Conexiones API y tocá{' '}
                  <span className="text-[var(--text2)]">Sincronizar</span>.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-3 font-medium text-[var(--text)]">{r.nombre || r.campaign_id}</td>
                  <td className="px-4 py-3 text-[var(--text2)]">{formatEstado(r.estado)}</td>
                  <td className="font-mono-num px-4 py-3 text-right tabular-nums">{formatUsd(r.spend)}</td>
                  <td className="font-mono-num px-4 py-3 text-right tabular-nums">
                    {formatIntegerEsAr(r.impressions)}
                  </td>
                  <td className="font-mono-num px-4 py-3 text-right tabular-nums">
                    {formatIntegerEsAr(r.clicks)}
                  </td>
                  <td className="font-mono-num px-4 py-3 text-right tabular-nums">
                    {formatIntegerEsAr(r.conversions)}
                  </td>
                  <td className="font-mono-num px-4 py-3 text-right tabular-nums">
                    {formatUsd(r.cost_per_conversion)}
                  </td>
                  <td className="font-mono-num px-4 py-3 text-right tabular-nums">{formatRoas(r.roas)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
