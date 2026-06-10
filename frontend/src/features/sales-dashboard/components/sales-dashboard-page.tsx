'use client'

import { useState, useEffect, useCallback, Fragment } from 'react'
import { useMonthContext } from '@/shared/components/app-providers'
import { MonthSelector } from '@/shared/components/month-selector'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { formatCash } from '@/shared/lib/format-utils'
import { Bar, Line } from '@/shared/components/charts'
import { getLeadsAnalytics } from '@/features/leads/services/leads-analytics'
import type { VDData } from '@/features/sales-dashboard/sales-dashboard-vd'

function fP(v: number) { return v.toFixed(1) + '%' }
function fPOrDash(v: number) {
  if (!Number.isFinite(v) || Number.isNaN(v)) return '—'
  return fP(v)
}
function fN(v: number) { return Math.round(v).toLocaleString('es-AR') }
function pct(o: number, n: number) { if (o === 0) return n > 0 ? 100 : 0; return ((n - o) / Math.abs(o)) * 100 }

export function SalesDashboardPage() {
  const { month, options, setMonth } = useMonthContext()
  const { ready, userId } = useAuthUser()
  const [tab, setTab] = useState<'mensual' | 'semanal' | 'diario'>('mensual')
  const [semana, setSemana] = useState(0)
  const [curr, setCurr] = useState<VDData | null>(null)
  const [prev, setPrev] = useState<VDData | null>(null)
  const [loading, setLoading] = useState(true)

  const buildVD = useCallback(async (m: string): Promise<VDData> => {
    const { analytics } = await getLeadsAnalytics(m)
    return {
      ...analytics,
      chats: analytics.chats,
      chatsReels: analytics.chatsReels,
      chatsStories: analytics.chatsStories,
      agendasByWeek: analytics.byWeek.agendas,
      conversacionesByWeek: analytics.byWeek.conversaciones,
      showsByWeek: analytics.byWeek.shows,
      cierresByWeek: analytics.byWeek.cierres,
      ingresosByWeek: analytics.byWeek.ingresos,
      noShowsByWeek: analytics.byWeek.noShows,
    }
  }, [])

  const fetchData = useCallback(async () => {
    if (!ready) return
    if (!userId) {
      setCurr(null)
      setPrev(null)
      setLoading(false)
      return
    }
    setLoading(true)
    const [y, m] = month.split('-').map(Number)
    const prevMonth = `${new Date(y, m - 2, 1).getFullYear()}-${String(new Date(y, m - 2, 1).getMonth() + 1).padStart(2, '0')}`
    try {
      const [c, p] = await Promise.all([buildVD(month), buildVD(prevMonth)])
      setCurr(c)
      setPrev(p)
    } finally {
      setLoading(false)
    }
  }, [month, ready, userId, buildVD])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  useEffect(() => {
    const refresh = () => {
      void fetchData()
    }
    window.addEventListener('atvmkt-team-reports-changed', refresh)
    window.addEventListener('offered-programs-updated', refresh)
    return () => {
      window.removeEventListener('atvmkt-team-reports-changed', refresh)
      window.removeEventListener('offered-programs-updated', refresh)
    }
  }, [fetchData])

  if (!ready || loading) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>

  if (!userId) {
    return <div className="py-12 text-center text-[var(--text3)]">Iniciá sesión para ver el panel de ventas.</div>
  }

  if (!curr || !prev) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>

  const delta = (key: keyof VDData) => pct(prev[key] as number, curr[key] as number)

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Dashboard <span className="text-[var(--text2)]">de Ventas</span></h2>
        <MonthSelector month={month} options={options} onChange={setMonth} />
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-lg bg-[var(--bg3)] border border-[var(--border)] p-1 w-fit">
        {(['mensual', 'semanal', 'diario'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2 text-[12px] font-medium rounded-md capitalize transition-all ${tab === t ? 'bg-[var(--accent)] text-white font-semibold' : 'text-[var(--text3)] hover:text-[var(--text2)]'}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'mensual' && <MensualView curr={curr} prev={prev} delta={delta} />}
      {tab === 'semanal' && <SemanalView curr={curr} />}
      {tab === 'diario' && <DiarioView curr={curr} semana={semana} setSemana={setSemana} />}
    </div>
  )
}

// ── KPI Component ──
function VDKpi({ label, value, change, hib = true }: { label: string; value: string; change?: number; hib?: boolean }) {
  const clr = change === undefined || change === 0 ? 'var(--text3)' : (hib ? change > 0 : change < 0) ? 'var(--green)' : '#F87171'
  const arrow = change !== undefined ? (change > 0 ? '▲' : change < 0 ? '▼' : '─') : ''
  return (
    <div className="glass-card p-5">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text2)] mb-2">{label}</div>
      <div className="font-mono-num text-[28px] font-bold tracking-tight">{value}</div>
      {change !== undefined && (
        <div className="mt-2 text-[11px] font-semibold inline-flex items-center gap-1" style={{ color: clr }}>
          {arrow} {Math.abs(change).toFixed(1)}%<span className="text-[var(--text3)] font-normal ml-1">vs mes ant.</span>
        </div>
      )}
    </div>
  )
}

// ── Funnel Component ──
function VDFunnel({ d }: { d: VDData }) {
  const steps = [
    { label: 'CHATS', value: d.chats },
    { label: 'CONVERSACIONES', value: d.conversaciones },
    { label: 'AGENDAS', value: d.agendas },
    { label: 'SHOWS', value: d.shows },
    { label: 'CIERRES', value: d.cierres },
  ]
  const rates = [
    { label: 'Tasa de conversación', rate: d.chats > 0 ? (d.conversaciones / d.chats) * 100 : 0 },
    { label: 'Tasa de agendamiento', rate: d.tasaAgendamiento },
    { label: 'Tasa de show', rate: d.showUpRate },
    { label: 'Tasa de cierre', rate: d.closeRate },
  ]
  const widths = [100, 75, 55, 42, 28]

  return (
    <div className="glass-card p-6">
      <div className="mb-4 text-[11px] font-medium uppercase tracking-widest text-[var(--text3)]">Embudo de Ventas</div>
      <div className="flex gap-8">
        {/* Funnel trapezoids */}
        <div className="flex-1 flex flex-col items-center gap-2">
          {steps.map((s, i) => (
            <div key={s.label} className="relative flex items-center justify-center py-3 transition-all" style={{
              width: `${widths[i]}%`,
              background: `rgba(230,57,70,${0.35 - i * 0.07})`,
              borderRadius: i === 0 ? '8px 8px 0 0' : i === steps.length - 1 ? '0 0 8px 8px' : '0',
              clipPath: i < steps.length - 1 ? `polygon(0 0, 100% 0, ${100 - (widths[i] - widths[i + 1]) / 2}% 100%, ${(widths[i] - widths[i + 1]) / 2}% 100%)` : undefined,
              minHeight: i === 0 ? '84px' : '70px',
            }}>
              <div className="text-center z-10">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[rgba(255,255,255,0.7)]">{s.label}</div>
                <div className="font-mono-num text-[22px] font-bold text-white">{s.value}</div>
                {s.label === 'CHATS' && (
                  <div className="mt-1 flex items-center justify-center gap-2 text-[9px] text-[rgba(255,255,255,0.6)]">
                    <span>Historias <span className="font-mono-num text-[rgba(255,255,255,0.85)]">{fN(d.chatsStories)}</span></span>
                    <span aria-hidden="true">·</span>
                    <span>Reels <span className="font-mono-num text-[rgba(255,255,255,0.85)]">{fN(d.chatsReels)}</span></span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        {/* Rates */}
        <div className="flex flex-col justify-center gap-6 w-48">
          {rates.map(r => {
            const clr = r.rate >= 50 ? 'var(--green)' : r.rate >= 20 ? 'var(--amber)' : 'var(--red)'
            const drop = 100 - r.rate
            return (
              <div key={r.label}>
                <div className="text-[11px] text-[var(--text3)] mb-1">{r.label}</div>
                <div className="flex items-baseline gap-2">
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: clr }} />
                  <span className="font-mono-num text-xl font-bold" style={{ color: clr }}>{fP(r.rate)}</span>
                </div>
                <div className="text-[10px] text-[var(--text3)] mt-0.5">-{drop.toFixed(0)}% drop</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── MENSUAL ──
function MensualView({ curr, prev, delta }: { curr: VDData; prev: VDData; delta: (k: keyof VDData) => number }) {
  const chgIngresos = delta('ingresos')
  const progTotal = curr.programas.reduce((s, p) => s + p.ingresos, 0) || 1
  const progColors = ['#F59E0B', '#3B82F6', '#FB923C', '#22C55E', '#A855F7']

  return (
    <div className="space-y-6">
      {/* Hero revenue */}
      <div className="glass-card p-6 flex flex-wrap items-center justify-between gap-6 relative accent-top">
        <div className="flex flex-wrap items-start gap-8 lg:gap-12">
          <div>
            <div className="text-[11px] text-[var(--text3)]">Facturacion</div>
            <div className="font-mono-num mt-1 text-3xl font-bold leading-none">{formatCash(curr.facturacion)}</div>
          </div>
          <div>
            <div className="text-[11px] text-[var(--text3)]">Cash Collected</div>
            <div className="mt-1 flex items-stretch gap-2 sm:gap-3">
              <div className="font-mono-num shrink-0 text-3xl font-bold leading-none text-[var(--green)] tabular-nums">
                {formatCash(curr.ingresos)}
              </div>
              <div className="flex min-h-0 min-w-[11rem] flex-1 flex-col justify-between border-l border-[var(--border)] pl-2.5 sm:min-w-[12rem] sm:pl-3">
                <div className="flex items-center justify-between gap-6 sm:gap-8">
                  <span className="text-[11px] text-[var(--text3)]">Pago</span>
                  <span className="font-mono-num text-[11px] font-semibold tabular-nums leading-none text-[var(--text2)]">
                    {formatCash(curr.cashCollectedComposition.pago)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-6 sm:gap-8">
                  <span className="text-[11px] text-[var(--text3)]">Seguimiento</span>
                  <span className="font-mono-num text-[11px] font-semibold tabular-nums leading-none text-[var(--text2)]">
                    {formatCash(curr.cashCollectedComposition.seguimiento)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-[13px] font-semibold ${chgIngresos >= 0 ? 'text-[var(--green)]' : 'text-[#F87171]'}`}>
            {chgIngresos >= 0 ? '▲' : '▼'} {Math.abs(chgIngresos).toFixed(1)}% vs mes ant.
          </div>
          <div className="text-[11px] text-[var(--text3)] mt-1">Ticket prom: {formatCash(curr.ticketPromedio)}</div>
        </div>
      </div>

      {/* Funnel */}
      <VDFunnel d={curr} />

      {/* 8 KPIs */}
      <div className="text-[11px] font-medium uppercase tracking-widest text-[var(--text3)]">Metricas del Mes</div>
      <div className="grid grid-cols-4 gap-3">
        <VDKpi label="Cash del mes" value={formatCash(curr.ingresos)} change={delta('ingresos')} />
        <VDKpi label="Conversaciones" value={fN(curr.conversaciones)} change={delta('conversaciones')} />
        <VDKpi label="Agendas" value={fN(curr.agendas)} change={delta('agendas')} />
        <VDKpi label="No Shows" value={fN(curr.noShows)} change={delta('noShows')} hib={false} />
        <VDKpi label="Show Up Rate" value={fP(curr.showUpRate)} change={delta('showUpRate')} />
        <VDKpi label="Close Rate" value={fP(curr.closeRate)} change={delta('closeRate')} />
        <VDKpi label="T. Agendamiento" value={fP(curr.tasaAgendamiento)} change={delta('tasaAgendamiento')} />
        <VDKpi label="AOV" value={formatCash(curr.aov)} change={delta('aov')} />
      </div>

      {/* Programas */}
      {curr.programas.length > 0 && (
        <>
          <div className="text-[11px] font-medium uppercase tracking-widest text-[var(--text3)]">Programas</div>
          <div className="grid grid-cols-[280px_1fr] gap-4">
            {/* Top program */}
            <div className="glass-card p-5">
              <div className="text-xl font-bold text-[var(--amber)]">{curr.programas[0].nombre}</div>
              <div className="text-[12px] text-[var(--text2)] mt-1">{curr.programas[0].ventas} ventas · {formatCash(curr.programas[0].ingresos)}</div>
              <div className="text-[11px] text-[var(--text3)] mt-0.5">{((curr.programas[0].ingresos / progTotal) * 100).toFixed(0)}% del total</div>
              <div className="mt-4 text-[10px] font-medium uppercase tracking-wider text-[var(--text3)] mb-2">Prog. Comprados</div>
              {curr.programas.map((p, i) => (
                <div key={p.nombre} className="flex items-center gap-2 py-1">
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: progColors[i % progColors.length] }} />
                  <span className="text-[12px] text-[var(--text2)]">{p.nombre}</span>
                  <span className="ml-auto font-mono-num text-[12px]">{p.ventas}</span>
                </div>
              ))}
            </div>
            {/* Breakdown bars */}
            <div className="glass-card p-5 space-y-2">
              {curr.programas.map((p, i) => (
                <div key={p.nombre}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[12px] font-semibold">{p.nombre}</span>
                    <span className="font-mono-num text-[12px] text-[var(--text2)]">{formatCash(p.ingresos)} · {((p.ingresos / progTotal) * 100).toFixed(0)}%</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-[var(--bg4)]">
                    <div className="h-full rounded-full transition-all" style={{ width: `${(p.ingresos / progTotal) * 100}%`, backgroundColor: progColors[i % progColors.length] }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Comparaciones table */}
      <div className="text-[11px] font-medium uppercase tracking-widest text-[var(--text3)]">Comparaciones</div>
      <div className="glass-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Metrica</th>
              <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Mes anterior</th>
              <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Mes actual</th>
              <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Var.</th>
            </tr>
          </thead>
          <tbody>
            {([
              ['Conversaciones', fN(prev.conversaciones), fN(curr.conversaciones), delta('conversaciones')],
              ['Agendas', fN(prev.agendas), fN(curr.agendas), delta('agendas')],
              ['No Shows', fN(prev.noShows), fN(curr.noShows), delta('noShows')],
              ['Show Up Rate', fP(prev.showUpRate), fP(curr.showUpRate), delta('showUpRate')],
              ['T. Agendamiento', fP(prev.tasaAgendamiento), fP(curr.tasaAgendamiento), delta('tasaAgendamiento')],
              ['Close Rate', fP(prev.closeRate), fP(curr.closeRate), delta('closeRate')],
              ['Cash/Agenda', formatCash(prev.cashPorAgenda), formatCash(curr.cashPorAgenda), delta('cashPorAgenda')],
              ['Cash/Show', formatCash(prev.cashPorShow), formatCash(curr.cashPorShow), delta('cashPorShow')],
              ['Ticket Promedio', formatCash(prev.ticketPromedio), formatCash(curr.ticketPromedio), delta('ticketPromedio')],
              ['AOV', formatCash(prev.aov), formatCash(curr.aov), delta('aov')],
              ['Ingresos', formatCash(prev.ingresos), formatCash(curr.ingresos), delta('ingresos')],
            ] as [string, string, string, number][]).map(([label, pv, cv, chg]) => (
              <tr key={label} className="border-b border-[var(--border)]">
                <td className="px-5 py-2.5 text-[13px] font-medium">{label}</td>
                <td className="px-5 py-2.5 font-mono-num text-[13px] text-[var(--text2)]">{pv}</td>
                <td className="px-5 py-2.5 font-mono-num text-[13px]">{cv}</td>
                <td className="px-5 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${chg >= 0 ? 'bg-[rgba(34,197,94,0.15)] text-[var(--green)]' : 'bg-[rgba(248,113,113,0.15)] text-[#F87171]'}`}>
                    {chg >= 0 ? '+' : ''}{chg.toFixed(1)}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── SEMANAL ──
type DashboardRowGroup = 'setter' | 'closer' | 'rates'

function dashboardGroupLabel(group: DashboardRowGroup): string {
  if (group === 'setter') return 'Setter'
  if (group === 'closer') return 'Closer'
  return 'Tasas'
}

function dashboardRowBg(group: DashboardRowGroup): string | undefined {
  if (group === 'setter') return 'rgba(59,130,246,0.04)'
  if (group === 'closer') return 'rgba(230,57,70,0.04)'
  return undefined
}

function dashboardGroupHeaderStyle(group: DashboardRowGroup) {
  const base = {
    padding: '6px 20px',
    fontSize: '10px',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
  }
  if (group === 'setter') {
    return {
      ...base,
      background: 'rgba(59,130,246,0.12)',
      color: 'rgb(96, 165, 250)',
      borderTop: '1px solid rgba(59,130,246,0.3)',
      borderLeft: '3px solid rgb(96, 165, 250)',
    }
  }
  if (group === 'closer') {
    return {
      ...base,
      background: 'rgba(230,57,70,0.12)',
      color: 'rgb(248, 113, 122)',
      borderTop: '1px solid rgba(230,57,70,0.3)',
      borderLeft: '3px solid rgb(248, 113, 122)',
    }
  }
  return {
    ...base,
    background: 'rgba(161,161,170,0.06)',
    color: 'var(--text2)',
    borderTop: '1px solid var(--border)',
    borderLeft: '3px solid var(--border2)',
  }
}

function SemanalView({ curr }: { curr: VDData }) {
  const { month } = useMonthContext()
  const [year, mon] = month.split('-').map(Number)
  const daysInMonth = new Date(year, mon, 0).getDate()

  // Encontrar el primer lunes del mes
  let firstMonday = 1
  for (let d = 1; d <= 7; d++) {
    const dow = new Date(year, mon - 1, d).getDay()
    if (dow === 1) {
      firstMonday = d
      break
    }
  }

  const weeks = [0, 1, 2, 3].map((i) => {
    const start = firstMonday + i * 7
    const end = Math.min(start + 6, daysInMonth)
    if (start > daysInMonth) return `Sem ${i + 1}`
    return `Sem ${i + 1} (${start}–${end})`
  })
  const showUpRates = curr.agendasByWeek.map((a, i) => {
    const sh = curr.showsByWeek[i] ?? 0
    if (a > 0) return (sh / a) * 100
    return sh > 0 ? Number.NaN : 0
  })
  const closeRates = curr.showsByWeek.map((s, i) => {
    const ci = curr.cierresByWeek[i] ?? 0
    if (s > 0) return (ci / s) * 100
    return ci > 0 ? Number.NaN : 0
  })
  const tasaAgend = curr.conversacionesByWeek.map((c, i) => c > 0 ? (curr.agendasByWeek[i] / c) * 100 : 0)
  const aovW = curr.cierresByWeek.map((c, i) =>
    c > 0 ? (curr.byWeek.facturacion[i] ?? 0) / c : 0,
  )

  type SemanalRowGroup = DashboardRowGroup
  type SemanalRow = {
    label: string
    data: number[]
    group: SemanalRowGroup
    fmt?: (v: number) => string
  }

  const rows: SemanalRow[] = [
    { label: 'Conversaciones', data: curr.conversacionesByWeek, group: 'setter' },
    { label: 'Leads nuevos', data: curr.byWeek.leads_nuevos, group: 'setter' },
    { label: 'Seguimientos', data: curr.byWeek.seguimientos, group: 'setter' },
    { label: 'Outbounds', data: curr.byWeek.outbounds, group: 'setter' },
    { label: 'Agendas', data: curr.agendasByWeek, group: 'setter' },
    { label: 'Shows', data: curr.showsByWeek, group: 'closer' },
    { label: 'No Shows', data: curr.noShowsByWeek, group: 'closer' },
    { label: 'Cierres', data: curr.cierresByWeek, group: 'closer' },
    { label: 'Ingresos (reportes)', data: curr.ingresosByWeek, group: 'closer', fmt: formatCash },
    { label: 'T. Agendamiento %', data: tasaAgend, group: 'rates', fmt: fP },
    { label: 'Show Up Rate %', data: showUpRates, group: 'rates', fmt: fPOrDash },
    { label: 'Close Rate %', data: closeRates, group: 'rates', fmt: fPOrDash },
    { label: 'AOV', data: aovW, group: 'rates', fmt: formatCash },
  ]

  const totalColumns = weeks.length + 1

  return (
    <div className="space-y-6">
      {/* Table */}
      <div className="glass-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Metrica</th>
              {weeks.map(w => <th key={w} className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">{w}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const prevGroup = idx > 0 ? rows[idx - 1].group : null
              const showGroupLabel = prevGroup !== r.group
              return (
                <Fragment key={r.label}>
                  {showGroupLabel ? (
                    <tr>
                      <td colSpan={totalColumns} style={dashboardGroupHeaderStyle(r.group)}>
                        {dashboardGroupLabel(r.group)}
                      </td>
                    </tr>
                  ) : null}
                  <tr className="border-b border-[var(--border)]" style={{ backgroundColor: dashboardRowBg(r.group) }}>
                    <td className="px-5 py-2.5 text-[13px] font-medium">{r.label}</td>
                    {r.data.map((v, i) => (
                      <td key={i} className="px-5 py-2.5 font-mono-num text-[13px]">
                        {r.fmt ? r.fmt(v) : fN(v)}
                      </td>
                    ))}
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-4">
        <ChartCard title="Agendas por semana" value={String(curr.agendasByWeek.reduce((s, v) => s + v, 0))} subtitle="total">
          <Bar data={{ labels: weeks, datasets: [{ data: curr.agendasByWeek, backgroundColor: 'rgba(245,158,11,0.25)', hoverBackgroundColor: '#F59E0B', borderRadius: 8, borderSkipped: false, barPercentage: 0.5, categoryPercentage: 0.7 }] }}
            options={{ responsive: true, maintainAspectRatio: false, scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: 'rgba(161,161,170,0.6)', font: { size: 11 } } }, y: { grid: { color: 'rgba(255,255,255,0.03)', drawTicks: false }, border: { display: false }, ticks: { color: 'rgba(161,161,170,0.4)', font: { size: 10 }, padding: 8, maxTicksLimit: 4 } } }, plugins: { tooltip: { backgroundColor: 'rgba(0,0,0,0.85)', padding: 10, cornerRadius: 8, displayColors: false } } }} />
        </ChartCard>
        <ChartCard title="Ingresos por semana" value={formatCash(curr.ingresosByWeek.reduce((s, v) => s + v, 0))} subtitle="closer ventas + seguimiento">
          <Bar data={{ labels: weeks, datasets: [{ data: curr.ingresosByWeek, backgroundColor: 'rgba(34,197,94,0.25)', hoverBackgroundColor: '#22C55E', borderRadius: 8, borderSkipped: false, barPercentage: 0.5, categoryPercentage: 0.7 }] }}
            options={{ responsive: true, maintainAspectRatio: false, scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: 'rgba(161,161,170,0.6)', font: { size: 11 } } }, y: { grid: { color: 'rgba(255,255,255,0.03)', drawTicks: false }, border: { display: false }, ticks: { color: 'rgba(161,161,170,0.4)', font: { size: 10 }, padding: 8, maxTicksLimit: 4, callback: (v: string | number) => '$' + (Number(v) >= 1000 ? (Number(v) / 1000).toFixed(0) + 'k' : v) } } }, plugins: { tooltip: { backgroundColor: 'rgba(0,0,0,0.85)', padding: 10, cornerRadius: 8, displayColors: false, callbacks: { label: (ctx: { parsed: { y: number | null } }) => formatCash(ctx.parsed.y ?? 0) } } } }} />
        </ChartCard>
        <ChartCard title="Show Up Rate" value={fP(showUpRates.filter(v => v > 0).reduce((s, v, _, a) => s + v / a.length, 0))} subtitle="promedio">
          <Line data={{ labels: weeks, datasets: [{ data: showUpRates, borderColor: '#60A5FA', backgroundColor: 'rgba(96,165,250,0.06)', fill: true, tension: 0.4, pointRadius: 5, pointBackgroundColor: '#60A5FA', pointBorderColor: 'rgba(0,0,0,0.3)', pointBorderWidth: 2, pointHoverRadius: 7, pointHoverBackgroundColor: '#60A5FA', pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2, borderWidth: 2.5 }] }}
            options={{ responsive: true, maintainAspectRatio: false, scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: 'rgba(161,161,170,0.6)', font: { size: 11 } } }, y: { grid: { color: 'rgba(255,255,255,0.03)', drawTicks: false }, border: { display: false }, ticks: { color: 'rgba(161,161,170,0.4)', font: { size: 10 }, padding: 8, maxTicksLimit: 4, callback: (v: string | number) => v + '%' }, min: 0, max: 100 } }, plugins: { tooltip: { backgroundColor: 'rgba(0,0,0,0.85)', padding: 10, cornerRadius: 8, displayColors: false, callbacks: { label: (ctx: { parsed: { y: number | null } }) => (ctx.parsed.y ?? 0).toFixed(1) + '%' } } } }} />
        </ChartCard>
        <ChartCard title="Close Rate" value={fP(closeRates.filter(v => v > 0).reduce((s, v, _, a) => s + v / a.length, 0))} subtitle="promedio">
          <Line data={{ labels: weeks, datasets: [{ data: closeRates, borderColor: '#A855F7', backgroundColor: 'rgba(168,85,247,0.06)', fill: true, tension: 0.4, pointRadius: 5, pointBackgroundColor: '#A855F7', pointBorderColor: 'rgba(0,0,0,0.3)', pointBorderWidth: 2, pointHoverRadius: 7, pointHoverBackgroundColor: '#A855F7', pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2, borderWidth: 2.5 }] }}
            options={{ responsive: true, maintainAspectRatio: false, scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: 'rgba(161,161,170,0.6)', font: { size: 11 } } }, y: { grid: { color: 'rgba(255,255,255,0.03)', drawTicks: false }, border: { display: false }, ticks: { color: 'rgba(161,161,170,0.4)', font: { size: 10 }, padding: 8, maxTicksLimit: 4, callback: (v: string | number) => v + '%' }, min: 0, max: 100 } }, plugins: { tooltip: { backgroundColor: 'rgba(0,0,0,0.85)', padding: 10, cornerRadius: 8, displayColors: false, callbacks: { label: (ctx: { parsed: { y: number | null } }) => (ctx.parsed.y ?? 0).toFixed(1) + '%' } } } }} />
        </ChartCard>
      </div>
    </div>
  )
}

// ── DIARIO ──
function getDayLabels(month: string, semana: number): string[] {
  const [year, mon] = month.split('-').map(Number)
  const days = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom']
  const startDay = semana * 7 + 1
  const endDay = Math.min(startDay + 6, new Date(year, mon, 0).getDate())

  const labels = days.map((d, dow) => {
    for (let day = startDay; day <= endDay; day++) {
      const date = new Date(year, mon - 1, day)
      const dateDow = (date.getDay() + 6) % 7
      if (dateDow === dow) return `${d} ${day}`
    }
    return d
  })
  return labels
}

function DiarioView({ curr, semana, setSemana }: { curr: VDData; semana: number; setSemana: (s: number) => void }) {
  const { month } = useMonthContext()
  const dayLabels = getDayLabels(month, semana)
  const wd = curr.byWeekDay
  const w = semana
  const conv = wd.conversaciones[w]
  const leadsNuevos = wd.leads_nuevos[w]
  const seguimientos = wd.seguimientos[w]
  const outbounds = wd.outbounds[w]
  const agendas = wd.agendas[w]
  const shows = wd.shows[w]
  const noShowsD = wd.noShows[w]
  const cierres = wd.cierres[w]
  const ingresos = wd.ingresos[w]
  const facturacionD = wd.facturacion[w]
  const showUpD = agendas.map((a, i) => {
    const s = shows[i] ?? 0
    if (a > 0) return (s / a) * 100
    return s > 0 ? Number.NaN : 0
  })
  const closeD = shows.map((s, i) => {
    const c = cierres[i] ?? 0
    if (s > 0) return (c / s) * 100
    return c > 0 ? Number.NaN : 0
  })
  const tasaAgD = conv.map((c, i) => c > 0 ? (agendas[i] / c) * 100 : 0)
  const aovD = cierres.map((c, i) => (c > 0 ? facturacionD[i] / c : 0))

  const sum = (arr: number[]) => arr.reduce((s, v) => s + v, 0)
  const sumAg = sum(agendas)
  const sumSh = sum(shows)
  const sumCi = sum(cierres)
  const sumFact = sum(facturacionD)
  const sumIng = sum(ingresos)
  const sumConv = sum(conv)
  const sumLeadsNuevos = sum(leadsNuevos)
  const sumSeguimientos = sum(seguimientos)
  const sumOutbounds = sum(outbounds)

  type DiarioRowGroup = DashboardRowGroup
  type DiarioRow = {
    label: string
    data: number[]
    total: number
    group: DiarioRowGroup
    fmt?: (v: number) => string
  }

  const rows: DiarioRow[] = [
    { label: 'Conversaciones', data: conv, total: sumConv, group: 'setter' },
    { label: 'Leads nuevos', data: leadsNuevos, total: sumLeadsNuevos, group: 'setter' },
    { label: 'Seguimientos', data: seguimientos, total: sumSeguimientos, group: 'setter' },
    { label: 'Outbounds', data: outbounds, total: sumOutbounds, group: 'setter' },
    { label: 'Agendas', data: agendas, total: sumAg, group: 'setter' },
    { label: 'Shows', data: shows, total: sumSh, group: 'closer' },
    { label: 'No Shows', data: noShowsD, total: sum(noShowsD), group: 'closer' },
    { label: 'Cierres', data: cierres, total: sumCi, group: 'closer' },
    { label: 'Ingresos (reportes)', data: ingresos, total: sumIng, group: 'closer', fmt: formatCash },
    { label: 'T. Agendamiento', data: tasaAgD, total: sumConv > 0 ? (sumAg / sumConv) * 100 : 0, group: 'rates', fmt: fP },
    {
      label: 'Show Up Rate',
      data: showUpD,
      total: sumAg > 0 ? (sumSh / sumAg) * 100 : sumSh > 0 ? Number.NaN : 0,
      group: 'rates',
      fmt: fPOrDash,
    },
    {
      label: 'Close Rate',
      data: closeD,
      total: sumSh > 0 ? (sumCi / sumSh) * 100 : sumCi > 0 ? Number.NaN : 0,
      group: 'rates',
      fmt: fPOrDash,
    },
    { label: 'AOV', data: aovD, total: sumCi > 0 ? sumFact / sumCi : 0, group: 'rates', fmt: formatCash },
  ]

  const totalColumns = dayLabels.length + 2

  return (
    <div className="space-y-6">
      {/* Week selector */}
      <div className="flex gap-2">
        {[0, 1, 2, 3].map(i => (
          <button key={i} onClick={() => setSemana(i)}
            className={`px-4 py-2 text-[12px] font-medium rounded-md transition-all ${semana === i ? 'bg-[var(--accent)] text-white font-semibold' : 'text-[var(--text3)] hover:text-[var(--text2)]'}`}>
            Semana {i + 1}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Metrica</th>
              {dayLabels.map((d) => (
                <th key={d} className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
                  {d}
                </th>
              ))}
              <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const prevGroup = idx > 0 ? rows[idx - 1].group : null
              const showGroupLabel = prevGroup !== r.group
              return (
                <Fragment key={r.label}>
                  {showGroupLabel ? (
                    <tr>
                      <td colSpan={totalColumns} style={dashboardGroupHeaderStyle(r.group)}>
                        {dashboardGroupLabel(r.group)}
                      </td>
                    </tr>
                  ) : null}
                  <tr className="border-b border-[var(--border)]" style={{ backgroundColor: dashboardRowBg(r.group) }}>
                    <td className="px-5 py-2.5 text-[13px] font-medium">{r.label}</td>
                    {r.data.map((v, i) => (
                      <td key={i} className="px-5 py-2.5 font-mono-num text-[13px]">
                        {r.fmt ? r.fmt(v) : fN(v)}
                      </td>
                    ))}
                    <td className="px-5 py-2.5 font-mono-num text-[13px] text-[var(--accent)] font-semibold">
                      {r.fmt ? r.fmt(r.total) : fN(r.total)}
                    </td>
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-4">
        <ChartCard title={`Agendas diarias — Semana ${semana + 1}`} value={String(agendas.reduce((s, v) => s + v, 0))} subtitle="total">
          <Bar data={{ labels: dayLabels, datasets: [{ data: agendas, backgroundColor: 'rgba(245,158,11,0.25)', hoverBackgroundColor: '#F59E0B', borderRadius: 6, borderSkipped: false, barPercentage: 0.6, categoryPercentage: 0.8 }] }}
            options={{ responsive: true, maintainAspectRatio: false, scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: 'rgba(161,161,170,0.6)', font: { size: 11 } } }, y: { grid: { color: 'rgba(255,255,255,0.03)', drawTicks: false }, border: { display: false }, ticks: { color: 'rgba(161,161,170,0.4)', font: { size: 10 }, padding: 8, maxTicksLimit: 4 } } }, plugins: { tooltip: { backgroundColor: 'rgba(0,0,0,0.85)', padding: 10, cornerRadius: 8, displayColors: false } } }} />
        </ChartCard>
        <ChartCard title="Ingresos diarios" value={formatCash(ingresos.reduce((s, v) => s + v, 0))} subtitle="closer ventas + seguimiento">
          <Bar data={{ labels: dayLabels, datasets: [{ data: ingresos, backgroundColor: 'rgba(34,197,94,0.25)', hoverBackgroundColor: '#22C55E', borderRadius: 6, borderSkipped: false, barPercentage: 0.6, categoryPercentage: 0.8 }] }}
            options={{ responsive: true, maintainAspectRatio: false, scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: 'rgba(161,161,170,0.6)', font: { size: 11 } } }, y: { grid: { color: 'rgba(255,255,255,0.03)', drawTicks: false }, border: { display: false }, ticks: { color: 'rgba(161,161,170,0.4)', font: { size: 10 }, padding: 8, maxTicksLimit: 4, callback: (v: string | number) => '$' + (Number(v) >= 1000 ? (Number(v) / 1000).toFixed(0) + 'k' : v) } } }, plugins: { tooltip: { backgroundColor: 'rgba(0,0,0,0.85)', padding: 10, cornerRadius: 8, displayColors: false, callbacks: { label: (ctx: { parsed: { y: number | null } }) => formatCash(ctx.parsed.y ?? 0) } } } }} />
        </ChartCard>
      </div>
    </div>
  )
}

// ── Chart wrapper ──
function ChartCard({ title, value, subtitle, children }: { title: string; value?: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="glass-card p-5">
      <div className="flex items-start justify-between mb-4">
        <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--text3)]">{title}</div>
        {value && (
          <div className="text-right">
            <div className="font-mono-num text-[18px] font-bold leading-tight">{value}</div>
            {subtitle && <div className="text-[9px] text-[var(--text3)]">{subtitle}</div>}
          </div>
        )}
      </div>
      <div className="h-44">{children}</div>
    </div>
  )
}
