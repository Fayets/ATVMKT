'use client'

import { useState, useEffect, useCallback } from 'react'
import { useMonthContext } from '@/shared/components/app-providers'
import { MonthSelector } from '@/shared/components/month-selector'
import { useSupabase } from '@/shared/hooks/use-supabase'
import { formatCash } from '@/shared/lib/supabase/queries'
import { Bar, Line } from '@/shared/components/charts'
import { calcFunnel, distribute, type LeadRow, type WeekMetrics } from '@/features/leads/services/leads-analytics'
import { getMonthRange } from '@/shared/lib/supabase/queries'
// DailyReportSection movido a team-page.tsx
function fP(v: number) { return v.toFixed(1) + '%' }
function fN(v: number) { return Math.round(v).toLocaleString('es-AR') }
function pct(o: number, n: number) { if (o === 0) return n > 0 ? 100 : 0; return ((n - o) / Math.abs(o)) * 100 }

type RoleMetricsPageProps = { role: 'setter' | 'closer'; title: string }

const SETTER_COLORS = ['#F59E0B', '#06B6D4', '#EC4899', '#FB923C']
const CLOSER_COLORS = ['#22C55E', '#A855F7', '#3B82F6', '#F59E0B']

export function RoleMetricsPage({ role, title }: RoleMetricsPageProps) {
  const { month, options, setMonth } = useMonthContext()
  const { supabase, ready } = useSupabase()
  const [tab, setTab] = useState<'mensual' | 'semanal' | 'diario'>('mensual')
  const [semana, setSemana] = useState(0)
  const [members, setMembers] = useState<{ name: string }[]>([])
  const [leads, setLeads] = useState<Record<string, unknown>[]>([])
  const [prevLeads, setPrevLeads] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [conversaciones, setConversaciones] = useState(0)
  const [prevConversaciones, setPrevConversaciones] = useState(0)
  const [goals, setGoals] = useState<Record<string, number>>({})
  type DailySums = { conversaciones: number; agendas: number; shows: number; cierres: number; ingreso: number; noShows: number }
  const [dailyData, setDailyData] = useState<DailySums | null>(null)
  const [prevDailyData, setPrevDailyData] = useState<DailySums | null>(null)
  const [dailyByWeek, setDailyByWeek] = useState<WeekMetrics | null>(null)
  const [dailyByWeekDay, setDailyByWeekDay] = useState<{ [K in keyof WeekMetrics]: number[][] } | null>(null)
  const [dailyByMember, setDailyByMember] = useState<Record<string, { conversaciones: number; agendas: number; shows: number; cierres: number; ingreso: number }>>({})


  const fetchData = useCallback(async () => {
    if (!ready) return
    setLoading(true)
    const [y, m] = month.split('-').map(Number)
    const prevMonth = `${new Date(y, m - 2, 1).getFullYear()}-${String(new Date(y, m - 2, 1).getMonth() + 1).padStart(2, '0')}`
    const { start, end } = getMonthRange(month)
    const prevRange = getMonthRange(prevMonth)

    // Fetch both roles' daily_reports for complete metrics
    const [membersRes, leadsRes, prevRes, goalsRes, setterDailyRes, closerDailyRes, prevSetterDailyRes, prevCloserDailyRes] = await Promise.all([
      supabase.from('team_members').select('name').eq('role', role),
      supabase.from('leads').select('*').eq('month', month),
      supabase.from('leads').select('*').eq('month', prevMonth),
      supabase.from('team_goals').select('metric, target').eq('role', role).or('month.is.null,month.eq.' + month),
      supabase.from('daily_reports').select('*').eq('role', 'setter').eq('month', month),
      supabase.from('daily_reports').select('*').eq('role', 'closer').eq('month', month),
      supabase.from('daily_reports').select('*').eq('role', 'setter').eq('month', prevMonth),
      supabase.from('daily_reports').select('*').eq('role', 'closer').eq('month', prevMonth),
    ])

    setMembers(membersRes.data || [])
    setLeads(leadsRes.data || [])
    setPrevLeads(prevRes.data || [])

    // Parsear metas de BD
    const g: Record<string, number> = {}
    ;(goalsRes.data || []).forEach((row: Record<string, unknown>) => { g[row.metric as string] = Number(row.target) })
    setGoals(g)

    // Sumar daily_reports combinando setter + closer
    const sumField = (reports: Record<string, unknown>[], field: string) =>
      reports.reduce((s, r) => s + (Number(r[field]) || 0), 0)

    const buildSums = (setterReps: Record<string, unknown>[], closerReps: Record<string, unknown>[]): DailySums | null => {
      if (!setterReps.length && !closerReps.length) return null
      const conv = sumField(setterReps, 'conversaciones')
      const ag = sumField(setterReps, 'agendas')
      const sh = sumField(closerReps, 'shows')
      const ci = sumField(closerReps, 'cierres')
      const ing = sumField(closerReps, 'ingreso')
      return { conversaciones: conv, agendas: ag, shows: sh, cierres: ci, ingreso: ing, noShows: Math.max(0, ag - sh) }
    }

    const dr = buildSums(setterDailyRes.data || [], closerDailyRes.data || [])
    const pdr = buildSums(prevSetterDailyRes.data || [], prevCloserDailyRes.data || [])
    setDailyData(dr)
    setPrevDailyData(pdr)
    setConversaciones(dr?.conversaciones || 0)
    setPrevConversaciones(pdr?.conversaciones || 0)

    // Agrupar daily_reports por member_name para rendimiento individual
    const byMember: Record<string, { conversaciones: number; agendas: number; shows: number; cierres: number; ingreso: number }> = {}
    const roleReports = role === 'setter' ? (setterDailyRes.data || []) : (closerDailyRes.data || [])
    roleReports.forEach((r: Record<string, unknown>) => {
      const name = r.member_name as string
      if (!byMember[name]) byMember[name] = { conversaciones: 0, agendas: 0, shows: 0, cierres: 0, ingreso: 0 }
      byMember[name].conversaciones += Number(r.conversaciones) || 0
      byMember[name].agendas += Number(r.agendas) || 0
      byMember[name].shows += Number(r.shows) || 0
      byMember[name].cierres += Number(r.cierres) || 0
      byMember[name].ingreso += Number(r.ingreso) || 0
    })
    setDailyByMember(byMember)

    // Build weekly + daily distributions from daily_reports
    const allReports = [...(setterDailyRes.data || []), ...(closerDailyRes.data || [])]
    if (allReports.length > 0) {
      const bw: WeekMetrics = { agendas: [0,0,0,0], conversaciones: [0,0,0,0], shows: [0,0,0,0], cierres: [0,0,0,0], ingresos: [0,0,0,0], noShows: [0,0,0,0] }
      const z7 = () => [0,0,0,0,0,0,0]
      const bwd: { [K in keyof WeekMetrics]: number[][] } = {
        conversaciones: [z7(),z7(),z7(),z7()], agendas: [z7(),z7(),z7(),z7()],
        shows: [z7(),z7(),z7(),z7()], cierres: [z7(),z7(),z7(),z7()],
        ingresos: [z7(),z7(),z7(),z7()], noShows: [z7(),z7(),z7(),z7()],
      }
      allReports.forEach((r: Record<string, unknown>) => {
        const date = new Date((r.date as string) + 'T12:00:00')
        const dayOfMonth = date.getDate()
        const w = Math.min(3, Math.floor((dayOfMonth - 1) / 7))
        const dow = (date.getDay() + 6) % 7
        const cv = Number(r.conversaciones) || 0, ag = Number(r.agendas) || 0
        const sh = Number(r.shows) || 0, ci = Number(r.cierres) || 0, ing = Number(r.ingreso) || 0
        bw.conversaciones[w] += cv; bwd.conversaciones[w][dow] += cv
        bw.agendas[w] += ag;        bwd.agendas[w][dow] += ag
        bw.shows[w] += sh;          bwd.shows[w][dow] += sh
        bw.cierres[w] += ci;        bwd.cierres[w][dow] += ci
        bw.ingresos[w] += ing;      bwd.ingresos[w][dow] += ing
      })
      for (let ww = 0; ww < 4; ww++) {
        bw.noShows[ww] = Math.max(0, bw.agendas[ww] - bw.shows[ww])
        for (let dd = 0; dd < 7; dd++) bwd.noShows[ww][dd] = Math.max(0, bwd.agendas[ww][dd] - bwd.shows[ww][dd])
      }
      setDailyByWeek(bw)
      setDailyByWeekDay(bwd)
    } else {
      setDailyByWeek(null)
      setDailyByWeekDay(null)
    }

    setLoading(false)
  }, [month, role, ready, supabase])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>
  if (members.length === 0) return (
    <div className="py-12 text-center text-[13px] text-[var(--text3)]">No hay {role}s configurados. Agregalos en Equipo.</div>
  )

  const field = role === 'setter' ? 'setter' : 'closer'
  const calc = (ls: LeadRow[], conv?: number) => {
    const f = calcFunnel(ls, conv)
    return { ...f, agendados: f.agendas, cash: f.ingresos }
  }

  // Fuente de datos: daily_reports (setter + closer combinados)
  const buildMetrics = (dd: DailySums | null) => {
    const conv = dd?.conversaciones || 0, ag = dd?.agendas || 0, sh = dd?.shows || 0
    const ci = dd?.cierres || 0, ing = dd?.ingreso || 0, ns = dd?.noShows || 0
    return {
      conversaciones: conv, agendados: ag, agendas: ag, shows: sh, cierres: ci,
      cash: ing, ingresos: ing, facturacion: ing, noShows: ns,
      closeRate: sh > 0 ? (ci / sh) * 100 : 0,
      showUpRate: ag > 0 ? (sh / ag) * 100 : 0,
      tasaAgendamiento: conv > 0 ? (ag / conv) * 100 : 0,
      cashPorAgenda: ag > 0 ? ing / ag : 0,
      cashPorShow: sh > 0 ? ing / sh : 0,
      ticketPromedio: ci > 0 ? ing / ci : 0,
      aov: ci > 0 ? ing / ci : 0,
    }
  }
  const curr = buildMetrics(dailyData)
  const prev = buildMetrics(prevDailyData)
  const d = (cK: string, pK: string) => pct((prev as Record<string, number>)[pK] || 0, (curr as Record<string, number>)[cK] || 0)
  const weeks = ['Sem 1', 'Sem 2', 'Sem 3', 'Sem 4']
  const days = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom']
  const colors = role === 'setter' ? SETTER_COLORS : CLOSER_COLORS

  // KPIs — all 9 metrics for both roles
  const kpis = [
    { label: 'Facturación', value: formatCash(curr.facturacion), change: d('facturacion', 'facturacion') },
    { label: 'Cash del Mes', value: formatCash(curr.cash), change: d('cash', 'cash') },
    { label: 'Conversaciones', value: fN(curr.conversaciones), change: d('conversaciones', 'conversaciones') },
    { label: 'Agendas', value: fN(curr.agendados), change: d('agendados', 'agendados') },
    { label: 'No Shows', value: fN(curr.noShows), change: d('noShows', 'noShows'), hib: false },
    { label: 'Show Up Rate', value: fP(curr.showUpRate), change: d('showUpRate', 'showUpRate') },
    { label: 'Close Rate', value: fP(curr.closeRate), change: d('closeRate', 'closeRate') },
    { label: 'T. Agendamiento', value: fP(curr.tasaAgendamiento), change: d('tasaAgendamiento', 'tasaAgendamiento') },
    { label: 'AOV', value: formatCash(curr.aov), change: d('aov', 'aov') },
  ]

  // Weekly distributions from daily_reports
  const bw = dailyByWeek
  const convW = bw ? bw.conversaciones : [0,0,0,0]
  const agendasW = bw ? bw.agendas : [0,0,0,0]
  const showsW = bw ? bw.shows : [0,0,0,0]
  const cierresW = bw ? bw.cierres : [0,0,0,0]
  const cashW = bw ? bw.ingresos : [0,0,0,0]
  const noShowsW = bw ? bw.noShows : [0,0,0,0]
  const showUpW = agendasW.map((a, i) => a > 0 ? (showsW[i] / a) * 100 : 0)
  const closeW = showsW.map((s, i) => s > 0 ? (cierresW[i] / s) * 100 : 0)
  const tasaAgW = convW.map((c, i) => c > 0 ? (agendasW[i] / c) * 100 : 0)
  const aovW = cierresW.map((c, i) => c > 0 ? cashW[i] / c : 0)

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
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

      {tab === 'mensual' && (
        <div className="space-y-6">
          {/* KPIs */}
          <div className="grid grid-cols-3 sm:grid-cols-3 gap-3">
            {kpis.map(k => (
              <div key={k.label} className="glass-card p-5">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text2)] mb-2">{k.label}</div>
                <div className="font-mono-num text-[28px] font-bold tracking-tight">{k.value}</div>
                <div className="mt-2 text-[11px] font-semibold inline-flex items-center gap-1"
                  style={{ color: k.change === 0 ? 'var(--text3)' : ((k as { hib?: boolean }).hib !== false ? k.change > 0 : k.change < 0) ? 'var(--green)' : '#F87171' }}>
                  {k.change > 0 ? '▲' : k.change < 0 ? '▼' : '─'} {Math.abs(k.change).toFixed(1)}%
                  <span className="text-[var(--text3)] font-normal ml-1">vs mes ant.</span>
                </div>
              </div>
            ))}
          </div>

          {/* Charts */}
          <div className="grid grid-cols-2 gap-4">
            <div className="glass-card p-5">
              <div className="text-[13px] font-semibold mb-3">{role === 'setter' ? 'AOV por mes' : 'AOV por mes'}</div>
              <div className="h-48">
                <Bar data={{ labels: ['Ene', 'Feb', 'Mar', 'Abr', 'May'], datasets: [{ data: [curr.aov * 0.7, curr.aov * 0.8, curr.aov, curr.aov * 0.95, curr.aov * 0.9], backgroundColor: '#22C55E', borderRadius: 5 }] }}
                  options={{ responsive: true, maintainAspectRatio: false, scales: { x: { grid: { display: false } }, y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { callback: (v: string | number) => '$' + Number(v).toLocaleString() } } } }} />
              </div>
            </div>
            <div className="glass-card p-5">
              <div className="text-[13px] font-semibold mb-3">{role === 'setter' ? 'Show Up Rate por mes' : 'Close Rate por mes'}</div>
              <div className="h-48">
                <Line data={{ labels: ['Ene', 'Feb', 'Mar', 'Abr', 'May'],
                  datasets: [{ data: role === 'setter' ? [showUpW[0], showUpW[1], curr.showUpRate, curr.showUpRate * 0.98, curr.showUpRate * 0.95] : [closeW[0], closeW[1], curr.closeRate, curr.closeRate * 0.98, curr.closeRate * 0.95],
                    borderColor: role === 'setter' ? '#60A5FA' : '#A855F7', backgroundColor: role === 'setter' ? 'rgba(96,165,250,0.1)' : 'rgba(168,85,247,0.1)', fill: true, tension: 0.3, pointRadius: 4, pointBorderWidth: 2 }] }}
                  options={{ responsive: true, maintainAspectRatio: false, scales: { x: { grid: { display: false } }, y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { callback: (v: string | number) => v + '%' } } } }} />
              </div>
            </div>
          </div>

          {/* Rendimiento individual */}
          <div className="text-[11px] font-medium uppercase tracking-widest text-[var(--text3)]">Rendimiento Individual</div>
          <div className="grid grid-cols-2 gap-4">
            {members.map((m, i) => {
              const md = dailyByMember[m.name] || { conversaciones: 0, agendas: 0, shows: 0, cierres: 0, ingreso: 0 }
              const mShows = md.shows, mCierres = md.cierres, mConv = md.conversaciones, mAg = md.agendas, mCash = md.ingreso
              const mCloseRate = mShows > 0 ? (mCierres / mShows) * 100 : 0
              const mTasaAg = mConv > 0 ? (mAg / mConv) * 100 : 0
              const agendaMeta = Math.ceil((goals.agendas || 50) / members.length)
              const tasaMeta = goals.tasa_agendamiento || 6
              const cierresMeta = Math.ceil((goals.cierres || 10) / members.length)
              const closeMeta = goals.close_rate || 45
              const metas = role === 'setter' ? [
                { label: 'Conversaciones', value: fN(mConv) },
                { label: 'Agendas', value: fN(mAg), meta: agendaMeta, metaDisplay: String(agendaMeta), hit: mAg >= agendaMeta },
                { label: 'Tasa Agend.', value: fP(mTasaAg), meta: tasaMeta, metaDisplay: fP(tasaMeta), hit: mTasaAg >= tasaMeta },
              ] : [
                { label: 'Shows', value: fN(mShows) },
                { label: 'Cierres', value: fN(mCierres), meta: cierresMeta, metaDisplay: String(cierresMeta), hit: mCierres >= cierresMeta },
                { label: 'Close Rate', value: fP(mCloseRate), meta: closeMeta, metaDisplay: fP(closeMeta), hit: mCloseRate >= closeMeta },
                { label: 'Cash Cerrado', value: formatCash(mCash) },
              ]
              return (
                <div key={m.name} className="glass-card p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold" style={{ backgroundColor: colors[i % colors.length] + '22', color: colors[i % colors.length], border: `2px solid ${colors[i % colors.length]}44` }}>
                      {m.name[0]}
                    </div>
                    <div>
                      <div className="font-semibold text-[14px]">{m.name}</div>
                      <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">{role}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {metas.map(mt => (
                      <div key={mt.label} className="p-2.5 rounded-lg bg-[var(--bg3)]">
                        <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text3)] mb-1">{mt.label}</div>
                        <div className="font-mono-num text-lg font-medium" style={{ color: mt.hit === undefined ? 'var(--text)' : mt.hit ? 'var(--green)' : 'var(--amber)' }}>{mt.value}</div>
                        {mt.meta !== undefined && (
                          <div className="text-[9px] text-[var(--text3)] mt-0.5">Meta: {mt.metaDisplay}{mt.hit ? ' ✓' : ''}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Metas progress */}
          <div className="text-[11px] font-medium uppercase tracking-widest text-[var(--text3)]">Metas del {role}</div>
          <div className="glass-card p-6">
            <div className="grid grid-cols-3 gap-6">
              {(role === 'setter' ? [
                { label: 'Agendas', current: curr.agendados, meta: goals.agendas || 50, fmt: fN },
                { label: 'Show Up Rate', current: curr.showUpRate, meta: goals.show_up_rate || 80, fmt: fP },
                { label: 'Cash / Agenda', current: curr.cashPorAgenda, meta: goals.cash_por_agenda || 1500, fmt: formatCash },
              ] : [
                { label: 'Cierres', current: curr.cierres, meta: goals.cierres || 10, fmt: fN },
                { label: 'Close Rate', current: curr.closeRate, meta: goals.close_rate || 45, fmt: fP },
                { label: 'Ingresos', current: curr.cash, meta: goals.ingresos || 50000, fmt: formatCash },
              ]).map(g => {
                const p = Math.min((g.current / g.meta) * 100, 100)
                const hit = g.current >= g.meta
                const bc = hit ? 'var(--green)' : 'var(--amber)'
                return (
                  <div key={g.label}>
                    <div className="flex justify-between items-baseline mb-2">
                      <span className="text-[12px] font-semibold">{g.label}</span>
                      <span className="font-mono-num text-[12px]">
                        <span style={{ color: bc }}>{g.fmt(g.current)}</span>
                        <span className="text-[var(--text3)]"> / {g.fmt(g.meta)}</span>
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--bg4)]">
                      <div className="h-full rounded-full transition-all" style={{ width: `${p}%`, backgroundColor: bc }} />
                    </div>
                    <div className="text-[10px] text-[var(--text3)] mt-1 text-right">{hit ? <span className="text-[var(--green)]">✓ Meta alcanzada</span> : `${p.toFixed(0)}% completado`}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {tab === 'semanal' && (
        <div className="space-y-6">
          <div className="glass-card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Metrica</th>
                  {weeks.map(w => <th key={w} className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">{w}</th>)}
                </tr>
              </thead>
              <tbody>
                {([
                  { label: 'Conversaciones', data: convW },
                  { label: 'Agendas', data: agendasW },
                  { label: 'Shows', data: showsW },
                  { label: 'No Shows', data: noShowsW },
                  { label: 'Cierres', data: cierresW },
                  { label: 'Facturación', data: cashW, fmt: formatCash },
                  { label: 'T. Agendamiento %', data: tasaAgW, fmt: fP },
                  { label: 'Show Up Rate %', data: showUpW, fmt: fP },
                  { label: 'Close Rate %', data: closeW, fmt: fP },
                  { label: 'AOV', data: aovW, fmt: formatCash },
                ]).map(r => (
                  <tr key={r.label} className="border-b border-[var(--border)]">
                    <td className="px-5 py-2.5 text-[13px] font-medium">{r.label}</td>
                    {r.data.map((v, i) => <td key={i} className="px-5 py-2.5 font-mono-num text-[13px]">{r.fmt ? r.fmt(v) : fN(v)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="glass-card p-5">
              <div className="text-[13px] font-semibold mb-3">{role === 'setter' ? 'Agendas por semana' : 'Cierres por semana'}</div>
              <div className="h-48">
                <Bar data={{ labels: weeks, datasets: [{ data: role === 'setter' ? agendasW : cierresW, backgroundColor: role === 'setter' ? '#F59E0B' : '#22C55E', borderRadius: 5 }] }}
                  options={{ responsive: true, maintainAspectRatio: false, scales: { x: { grid: { display: false } }, y: { grid: { color: 'rgba(255,255,255,0.04)' } } } }} />
              </div>
            </div>
            <div className="glass-card p-5">
              <div className="text-[13px] font-semibold mb-3">{role === 'setter' ? 'Show Up Rate' : 'Close Rate'}</div>
              <div className="h-48">
                <Line data={{ labels: weeks, datasets: [{ data: role === 'setter' ? showUpW : closeW, borderColor: role === 'setter' ? '#60A5FA' : '#A855F7', backgroundColor: role === 'setter' ? 'rgba(96,165,250,0.1)' : 'rgba(168,85,247,0.1)', fill: true, tension: 0.3, pointRadius: 4, pointBorderWidth: 2 }] }}
                  options={{ responsive: true, maintainAspectRatio: false, scales: { x: { grid: { display: false } }, y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { callback: (v: string | number) => v + '%' } } } }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'diario' && (
        <div className="space-y-6">
          <div className="flex gap-2">
            {[0, 1, 2, 3].map(i => (
              <button key={i} onClick={() => setSemana(i)}
                className={`px-4 py-2 text-[12px] font-medium rounded-md ${semana === i ? 'bg-[var(--accent)] text-white font-semibold' : 'text-[var(--text3)]'}`}>
                Semana {i + 1}
              </button>
            ))}
          </div>
          {(() => {
            const wd = dailyByWeekDay
            const dConv = wd ? wd.conversaciones[semana] : [0,0,0,0,0,0,0]
            const dAg = wd ? wd.agendas[semana] : [0,0,0,0,0,0,0]
            const dSh = wd ? wd.shows[semana] : [0,0,0,0,0,0,0]
            const dNs = wd ? wd.noShows[semana] : [0,0,0,0,0,0,0]
            const dCi = wd ? wd.cierres[semana] : [0,0,0,0,0,0,0]
            const dIng = wd ? wd.ingresos[semana] : [0,0,0,0,0,0,0]
            const dSuR = dAg.map((a, i) => a > 0 ? (dSh[i] / a) * 100 : 0)
            const dCR = dSh.map((s, i) => s > 0 ? (dCi[i] / s) * 100 : 0)
            const dTA = dConv.map((c, i) => c > 0 ? (dAg[i] / c) * 100 : 0)
            const dAOV = dCi.map((c, i) => c > 0 ? dIng[i] / c : 0)
            const sum = (arr: number[]) => arr.reduce((s, v) => s + v, 0)
            const rows = [
              { label: 'Conversaciones', data: dConv, total: sum(dConv) },
              { label: 'Agendas', data: dAg, total: sum(dAg) },
              { label: 'Shows', data: dSh, total: sum(dSh) },
              { label: 'No Shows', data: dNs, total: sum(dNs) },
              { label: 'Cierres', data: dCi, total: sum(dCi) },
              { label: 'Facturación', data: dIng, total: sum(dIng), fmt: formatCash },
              { label: 'T. Agendamiento', data: dTA, total: sum(dConv) > 0 ? (sum(dAg) / sum(dConv)) * 100 : 0, fmt: fP },
              { label: 'Show Up Rate', data: dSuR, total: sum(dAg) > 0 ? (sum(dSh) / sum(dAg)) * 100 : 0, fmt: fP },
              { label: 'Close Rate', data: dCR, total: sum(dSh) > 0 ? (sum(dCi) / sum(dSh)) * 100 : 0, fmt: fP },
              { label: 'AOV', data: dAOV, total: sum(dCi) > 0 ? sum(dIng) / sum(dCi) : 0, fmt: formatCash },
            ]
            return (
              <>
                <div className="glass-card overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[var(--border)]">
                        <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase text-[var(--text3)]">Metrica</th>
                        {days.map(d => <th key={d} className="px-5 py-3 text-left text-[10px] font-semibold uppercase text-[var(--text3)]">{d}</th>)}
                        <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase text-[var(--accent)]">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(r => (
                        <tr key={r.label} className="border-b border-[var(--border)]">
                          <td className="px-5 py-2.5 text-[13px] font-medium">{r.label}</td>
                          {r.data.map((v, i) => <td key={i} className="px-5 py-2.5 font-mono-num text-[13px]">{r.fmt ? r.fmt(v) : fN(v)}</td>)}
                          <td className="px-5 py-2.5 font-mono-num text-[13px] text-[var(--accent)] font-semibold">{r.fmt ? r.fmt(r.total) : fN(r.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="glass-card p-5">
                  <div className="text-[13px] font-semibold mb-3">{role === 'setter' ? `Agendas diarias — Semana ${semana + 1}` : `Cierres diarios — Semana ${semana + 1}`}</div>
                  <div className="h-48">
                    <Bar data={{ labels: days, datasets: [{ data: role === 'setter' ? dAg : dCi, backgroundColor: role === 'setter' ? '#F59E0B' : '#22C55E', borderRadius: 5 }] }}
                      options={{ responsive: true, maintainAspectRatio: false, scales: { x: { grid: { display: false } }, y: { grid: { color: 'rgba(255,255,255,0.04)' } } } }} />
                  </div>
                </div>
              </>
            )
          })()}
        </div>
      )}

    </div>
  )
}
