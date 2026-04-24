'use client'

import { useState, useEffect, useCallback } from 'react'
import { useMonthContext } from '@/shared/components/app-providers'
import { MonthSelector } from '@/shared/components/month-selector'
import { useSupabase } from '@/shared/hooks/use-supabase'
import { formatCash } from '@/shared/lib/supabase/queries'
import { Bar, Line } from '@/shared/components/charts'
import { getLeadsAnalytics, distribute, type LeadsAnalytics } from '@/features/leads/services/leads-analytics'

type VDData = LeadsAnalytics & {
  agendasByWeek: number[]; conversacionesByWeek: number[]; showsByWeek: number[]; cierresByWeek: number[]; ingresosByWeek: number[]; noShowsByWeek: number[]
}

function fP(v: number) { return v.toFixed(1) + '%' }
function fN(v: number) { return Math.round(v).toLocaleString('es-AR') }
function pct(o: number, n: number) { if (o === 0) return n > 0 ? 100 : 0; return ((n - o) / Math.abs(o)) * 100 }

export function SalesDashboardPage() {
  const { month, options, setMonth } = useMonthContext()
  const { supabase, ready } = useSupabase()
  const [tab, setTab] = useState<'mensual' | 'semanal' | 'diario'>('mensual')
  const [semana, setSemana] = useState(0)
  const [curr, setCurr] = useState<VDData | null>(null)
  const [prev, setPrev] = useState<VDData | null>(null)
  const [loading, setLoading] = useState(true)

  const buildVD = useCallback(async (m: string): Promise<VDData> => {
    const { analytics } = await getLeadsAnalytics(supabase, m)
    return {
      ...analytics,
      agendasByWeek: analytics.byWeek.agendas,
      conversacionesByWeek: analytics.byWeek.conversaciones,
      showsByWeek: analytics.byWeek.shows,
      cierresByWeek: analytics.byWeek.cierres,
      ingresosByWeek: analytics.byWeek.ingresos,
      noShowsByWeek: analytics.byWeek.noShows,
    }
  }, [supabase])

  const fetchData = useCallback(async () => {
    if (!ready) return
    setLoading(true)
    const [y, m] = month.split('-').map(Number)
    const prevMonth = `${new Date(y, m - 2, 1).getFullYear()}-${String(new Date(y, m - 2, 1).getMonth() + 1).padStart(2, '0')}`
    const [c, p] = await Promise.all([buildVD(month), buildVD(prevMonth)])
    setCurr(c); setPrev(p)
    setLoading(false)
  }, [month, ready, buildVD])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading || !curr || !prev) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>

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
    { label: 'CHATS', value: d.conversaciones },
    { label: 'AGENDAS', value: d.agendas },
    { label: 'SHOWS', value: d.shows },
    { label: 'CIERRES', value: d.cierres },
  ]
  const rates = [
    { label: 'Tasa de agendamiento', rate: d.tasaAgendamiento },
    { label: 'Tasa de show', rate: d.showUpRate },
    { label: 'Tasa de cierre', rate: d.closeRate },
  ]
  const widths = [100, 60, 42, 28]

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
              borderRadius: i === 0 ? '8px 8px 0 0' : i === 3 ? '0 0 8px 8px' : '0',
              clipPath: i < 3 ? `polygon(0 0, 100% 0, ${100 - (widths[i] - widths[i + 1]) / 2}% 100%, ${(widths[i] - widths[i + 1]) / 2}% 100%)` : undefined,
              minHeight: '70px',
            }}>
              <div className="text-center z-10">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[rgba(255,255,255,0.7)]">{s.label}</div>
                <div className="font-mono-num text-[22px] font-bold text-white">{s.value}</div>
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
      <div className="glass-card p-6 flex items-center justify-between relative accent-top">
        <div className="flex gap-12">
          <div>
            <div className="text-[11px] text-[var(--text3)]">Facturacion</div>
            <div className="font-mono-num text-3xl font-bold mt-1">{formatCash(curr.ingresos)}</div>
          </div>
          <div>
            <div className="text-[11px] text-[var(--text3)]">Cash Collected</div>
            <div className="font-mono-num text-3xl font-bold text-[var(--green)] mt-1">{formatCash(curr.ingresos)}</div>
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
function SemanalView({ curr }: { curr: VDData }) {
  const weeks = ['Sem 1', 'Sem 2', 'Sem 3', 'Sem 4']
  const showUpRates = curr.agendasByWeek.map((a, i) => a > 0 ? (curr.showsByWeek[i] / a) * 100 : 0)
  const closeRates = curr.showsByWeek.map((s, i) => s > 0 ? (curr.cierresByWeek[i] / s) * 100 : 0)
  const tasaAgend = curr.conversacionesByWeek.map((c, i) => c > 0 ? (curr.agendasByWeek[i] / c) * 100 : 0)
  const aovW = curr.cierresByWeek.map((c, i) => c > 0 ? curr.ingresosByWeek[i] / c : 0)

  const rows = [
    { label: 'Conversaciones', data: curr.conversacionesByWeek },
    { label: 'Agendas', data: curr.agendasByWeek },
    { label: 'Shows', data: curr.showsByWeek },
    { label: 'No Shows', data: curr.noShowsByWeek },
    { label: 'Cierres', data: curr.cierresByWeek },
    { label: 'Facturación', data: curr.ingresosByWeek, fmt: formatCash },
    { label: 'T. Agendamiento %', data: tasaAgend, fmt: fP },
    { label: 'Show Up Rate %', data: showUpRates, fmt: fP },
    { label: 'Close Rate %', data: closeRates, fmt: fP },
    { label: 'AOV', data: aovW, fmt: formatCash },
  ]

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
            {rows.map(r => (
              <tr key={r.label} className="border-b border-[var(--border)]">
                <td className="px-5 py-2.5 text-[13px] font-medium">{r.label}</td>
                {r.data.map((v, i) => (
                  <td key={i} className="px-5 py-2.5 font-mono-num text-[13px]">{r.fmt ? r.fmt(v) : fN(v)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-4">
        <ChartCard title="Agendas por semana" value={String(curr.agendasByWeek.reduce((s, v) => s + v, 0))} subtitle="total">
          <Bar data={{ labels: weeks, datasets: [{ data: curr.agendasByWeek, backgroundColor: 'rgba(245,158,11,0.25)', hoverBackgroundColor: '#F59E0B', borderRadius: 8, borderSkipped: false, barPercentage: 0.5, categoryPercentage: 0.7 }] }}
            options={{ responsive: true, maintainAspectRatio: false, scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: 'rgba(161,161,170,0.6)', font: { size: 11 } } }, y: { grid: { color: 'rgba(255,255,255,0.03)', drawTicks: false }, border: { display: false }, ticks: { color: 'rgba(161,161,170,0.4)', font: { size: 10 }, padding: 8, maxTicksLimit: 4 } } }, plugins: { tooltip: { backgroundColor: 'rgba(0,0,0,0.85)', padding: 10, cornerRadius: 8, displayColors: false } } }} />
        </ChartCard>
        <ChartCard title="Ingresos por semana" value={formatCash(curr.ingresosByWeek.reduce((s, v) => s + v, 0))} subtitle="total">
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
function DiarioView({ curr, semana, setSemana }: { curr: VDData; semana: number; setSemana: (s: number) => void }) {
  const days = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom']
  const wd = curr.byWeekDay
  const w = semana
  const conv = wd.conversaciones[w]
  const agendas = wd.agendas[w]
  const shows = wd.shows[w]
  const noShowsD = wd.noShows[w]
  const cierres = wd.cierres[w]
  const ingresos = wd.ingresos[w]
  const showUpD = agendas.map((a, i) => a > 0 ? (shows[i] / a) * 100 : 0)
  const closeD = shows.map((s, i) => s > 0 ? (cierres[i] / s) * 100 : 0)
  const tasaAgD = conv.map((c, i) => c > 0 ? (agendas[i] / c) * 100 : 0)
  const aovD = cierres.map((c, i) => c > 0 ? ingresos[i] / c : 0)

  const sum = (arr: number[]) => arr.reduce((s, v) => s + v, 0)
  const rows = [
    { label: 'Conversaciones', data: conv, total: sum(conv) },
    { label: 'Agendas', data: agendas, total: sum(agendas) },
    { label: 'Shows', data: shows, total: sum(shows) },
    { label: 'No Shows', data: noShowsD, total: sum(noShowsD) },
    { label: 'Cierres', data: cierres, total: sum(cierres) },
    { label: 'Facturación', data: ingresos, total: sum(ingresos), fmt: formatCash },
    { label: 'T. Agendamiento', data: tasaAgD, total: sum(conv) > 0 ? (sum(agendas) / sum(conv)) * 100 : 0, fmt: fP },
    { label: 'Show Up Rate', data: showUpD, total: sum(agendas) > 0 ? (sum(shows) / sum(agendas)) * 100 : 0, fmt: fP },
    { label: 'Close Rate', data: closeD, total: sum(shows) > 0 ? (sum(cierres) / sum(shows)) * 100 : 0, fmt: fP },
    { label: 'AOV', data: aovD, total: sum(cierres) > 0 ? sum(ingresos) / sum(cierres) : 0, fmt: formatCash },
  ]

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
              {days.map(d => <th key={d} className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">{d}</th>)}
              <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.label} className="border-b border-[var(--border)]">
                <td className="px-5 py-2.5 text-[13px] font-medium">{r.label}</td>
                {r.data.map((v, i) => (
                  <td key={i} className="px-5 py-2.5 font-mono-num text-[13px]">{r.fmt ? r.fmt(v) : fN(v)}</td>
                ))}
                <td className="px-5 py-2.5 font-mono-num text-[13px] text-[var(--accent)] font-semibold">{r.fmt ? r.fmt(r.total) : fN(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-4">
        <ChartCard title={`Agendas diarias — Semana ${semana + 1}`} value={String(agendas.reduce((s, v) => s + v, 0))} subtitle="total">
          <Bar data={{ labels: days, datasets: [{ data: agendas, backgroundColor: 'rgba(245,158,11,0.25)', hoverBackgroundColor: '#F59E0B', borderRadius: 6, borderSkipped: false, barPercentage: 0.6, categoryPercentage: 0.8 }] }}
            options={{ responsive: true, maintainAspectRatio: false, scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: 'rgba(161,161,170,0.6)', font: { size: 11 } } }, y: { grid: { color: 'rgba(255,255,255,0.03)', drawTicks: false }, border: { display: false }, ticks: { color: 'rgba(161,161,170,0.4)', font: { size: 10 }, padding: 8, maxTicksLimit: 4 } } }, plugins: { tooltip: { backgroundColor: 'rgba(0,0,0,0.85)', padding: 10, cornerRadius: 8, displayColors: false } } }} />
        </ChartCard>
        <ChartCard title="Ingresos diarios" value={formatCash(ingresos.reduce((s, v) => s + v, 0))} subtitle="total">
          <Bar data={{ labels: days, datasets: [{ data: ingresos, backgroundColor: 'rgba(34,197,94,0.25)', hoverBackgroundColor: '#22C55E', borderRadius: 6, borderSkipped: false, barPercentage: 0.6, categoryPercentage: 0.8 }] }}
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
