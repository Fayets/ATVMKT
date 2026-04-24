'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useMonthContext } from '@/shared/components/app-providers'
import { MonthSelector } from '@/shared/components/month-selector'
import { useSupabase } from '@/shared/hooks/use-supabase'
import { getMonthRange, formatCash, formatK } from '@/shared/lib/supabase/queries'
import { Line, Doughnut, Bar } from '@/shared/components/charts'
import { calcFunnel, type LeadRow } from '@/features/leads/services/leads-analytics'

// ── Custom Bar Chart ──
function CashBarChart({ labels, values, prevValues, activeIndex, onBarClick, compact }: {
  labels: string[]; values: number[]; prevValues: number[]; activeIndex: number
  onBarClick: (i: number) => void; compact?: boolean
}) {
  const [hover, setHover] = useState<number | null>(null)
  const maxVal = Math.max(...values, ...prevValues, 1)
  const maxH = compact ? 100 : 130 // max bar height in px

  return (
    <div className="w-full">
      {/* Bar groups */}
      <div className="flex items-end" style={{ height: maxH + 24, gap: compact ? 2 : 8, padding: '0 4px' }}>
        {labels.map((label, i) => {
          const isActive = i === activeIndex
          const isHovered = i === hover
          const barH = values[i] > 0 ? Math.max(Math.round((values[i] / maxVal) * maxH), 8) : 0
          const prevH = prevValues[i] > 0 ? Math.max(Math.round((prevValues[i] / maxVal) * maxH), 6) : 0

          return (
            <div key={i} className="flex-1 cursor-pointer"
              onClick={() => onBarClick(i)} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>

              {/* Value on top — shown on hover/active for all modes */}
              {(isActive || isHovered) && values[i] > 0 && (
                <div className="text-center text-[10px] font-mono-num font-bold mb-1 text-[#4ADE80]" style={{ textShadow: '0 0 8px rgba(74,222,128,0.5)' }}>
                  {formatCash(values[i])}
                </div>
              )}
              {!((isActive || isHovered) && values[i] > 0) && <div style={{ height: 18 }} />}

              {/* Two bars side by side */}
              <div className="flex items-end gap-[3px]">
                <div className="flex-[3] rounded-t-[6px] transition-all duration-300"
                  style={{
                    height: barH,
                    background: isActive
                      ? 'linear-gradient(to top, #16A34A, #4ADE80)'
                      : isHovered
                        ? 'linear-gradient(to top, rgba(22,163,74,0.45), rgba(74,222,128,0.65))'
                        : 'linear-gradient(to top, rgba(22,163,74,0.15), rgba(74,222,128,0.3))',
                    boxShadow: isActive ? '0 0 20px rgba(74,222,128,0.3)' : 'none',
                  }} />
                <div className="flex-1 rounded-t-[5px] transition-all duration-300"
                  style={{
                    height: prevH,
                    background: isActive || isHovered ? 'rgba(161,161,170,0.25)' : 'rgba(161,161,170,0.1)',
                  }} />
              </div>
            </div>
          )
        })}
      </div>

      {/* Labels */}
      {!compact ? (
        <div className="flex mt-2" style={{ gap: 8, padding: '0 4px' }}>
          {labels.map((label, i) => {
            const hasData = values[i] > 0
            const lit = (i === activeIndex || i === hover) && hasData
            return (
              <div key={i} className={`flex-1 text-center text-[10px] truncate cursor-pointer transition-all duration-200 ${lit && i === activeIndex ? 'text-[#4ADE80] font-semibold' : lit ? 'text-[#4ADE80]' : 'text-[#52525B]'}`}
                style={lit ? { textShadow: '0 0 10px rgba(74,222,128,0.6)' } : undefined}
                onClick={() => onBarClick(i)} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                {label}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="flex mt-1 px-1" style={{ gap: 2 }}>
          {labels.map((label, i) => {
            const hasData = values[i] > 0
            const lit = (i === activeIndex || i === hover) && hasData
            const show = i % Math.ceil(labels.length / 10) === 0 || i === labels.length - 1 || lit
            return (
              <div key={i} className="flex-1 text-center cursor-pointer"
                onClick={() => onBarClick(i)} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                {show && (
                  <span className={`text-[9px] transition-all duration-200 ${lit && i === activeIndex ? 'text-[#4ADE80] font-semibold' : lit ? 'text-[#4ADE80]' : 'text-[#52525B]'}`}
                    style={lit ? { textShadow: '0 0 10px rgba(74,222,128,0.6)' } : undefined}>
                    {label}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

type TypeformData = {
  total: number
  totalAll: number
  avgConviction: number
  programs: string[]
  data: Record<string, { label: string; count: number }[]>
}

type DashData = {
  cash: number; prevCash: number; prevCashAtDay: number
  chats: number; prevChats: number
  reelsChats: number; historiasChats: number; bioChats: number
  igCash: number; ytCash: number; refCash: number; defCash: number; bioCash: number
  historiasCash: number; reelsCash: number
  // Daily cash for chart
  dailyCash: number[]       // cumulative
  prevDailyCash: number[]   // cumulative
  rawDailyCash: number[]    // per-day
  rawPrevDailyCash: number[]
  // Daily metrics for tooltip
  dailyChats: number[]
  dailyAgendas: number[]
  dailyCierres: number[]
  // Raw data for view filtering
  rawLeads: LeadRow[]
  rawContent: { content_type: string; cash: number; chats: number; published_at: string }[]
  rawBio: { cash: number; chats: number }[]
  // Calls
  calls: { id: string; date: string; name: string; revenue: number; payment: number; program: string; closer: string; setter: string; status: string; callLink: string; closerReport: string; igHandle: string; phone: string; entryChannel: string; notes: string }[]
  // Onboarding
  programCounts: { program: string; count: number }[]
  // Funnel
  ventas: { cierres: number; cashCollected: number; ticketPromedio: number; closeRate: number; agendas: number; leads: number }
}

export default function DashboardPage() {
  const { month, options, setMonth } = useMonthContext()
  const { supabase, ready } = useSupabase()
  const [data, setData] = useState<DashData | null>(null)
  const [view, setView] = useState<'mensual' | 'semanal' | 'diaria'>('mensual')
  const [selectedDay, setSelectedDay] = useState<number | null>(null)   // 1-based day of month
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null) // 0-based week index
  const [typeform, setTypeform] = useState<TypeformData | null>(null)
  const [tfMonth, setTfMonth] = useState(month)
  const [tfProgram, setTfProgram] = useState<string>('')

  const fetchData = useCallback(async () => {
    if (!ready) return
    const { start, end } = getMonthRange(month)
    const prev = getPrevMonth(month)
    const { start: pStart, end: pEnd } = getMonthRange(prev)

    const [contentRes, bioRes, defRes, pContentRes, pBioRes, pDefRes, leadsRes, pLeadsRes, metricsRes] = await Promise.all([
      supabase.from('content_items').select('content_type, cash, chats, published_at').gte('published_at', start).lte('published_at', end),
      supabase.from('bio_entries').select('cash, chats').eq('month', month),
      supabase.from('deferred_entries').select('cash').eq('month', month),
      supabase.from('content_items').select('content_type, cash, chats').gte('published_at', pStart).lte('published_at', pEnd),
      supabase.from('bio_entries').select('cash, chats').eq('month', prev),
      supabase.from('deferred_entries').select('cash').eq('month', prev),
      supabase.from('leads').select('*').eq('month', month),
      supabase.from('leads').select('*').eq('month', prev),
      supabase.from('daily_metrics').select('date, conversaciones, agendas, cierres').eq('month', month),
    ])

    const items = contentRes.data || []
    const bio = bioRes.data || []
    const def_ = defRes.data || []
    const sum = (arr: Record<string, unknown>[], key: string) => arr.reduce((s, i) => s + (Number(i[key]) || 0), 0)
    const byType = (type: string) => items.filter((i: Record<string, unknown>) => i.content_type === type || (type === 'historia' && i.content_type === 'story'))

    const reelsChats = sum(byType('reel'), 'chats')
    const historiasChats = sum(byType('historia'), 'chats')
    const bioChats = sum(bio, 'chats')
    const chats = reelsChats + historiasChats + bioChats

    // Leads
    const currLeads = (leadsRes.data || []) as LeadRow[]
    const prevLeadsData = (pLeadsRes.data || []) as LeadRow[]
    const currFunnel = calcFunnel(currLeads)
    const prevFunnel = calcFunnel(prevLeadsData)

    const cashByChannel = (leads: LeadRow[], channel: string) =>
      leads.filter(l => l.entry_channel === channel && Number(l.payment) > 0).reduce((s, l) => s + (Number(l.payment) || 0), 0)
    const igCash = cashByChannel(currLeads, 'IG Chat')
    const ytCash = cashByChannel(currLeads, 'YouTube')
    const refCash = cashByChannel(currLeads, 'Referido')
    const defCash = sum(def_, 'cash')
    const reelsCash = sum(byType('reel'), 'cash')
    const historiasCash = sum(byType('historia'), 'cash')
    const bioCash = sum(bio, 'cash')
    const cash = currFunnel.ingresos + defCash

    // Previous month
    const pItems = pContentRes.data || []
    const prevCash = prevFunnel.ingresos + sum(pDefRes.data || [], 'cash')
    const prevChats = sum(pItems, 'chats') + sum(pBioRes.data || [], 'chats')

    // Daily cash from leads (by payment date or call_at)
    const [y, m] = month.split('-').map(Number)
    const daysInMonth = new Date(y, m, 0).getDate()
    const dailyCash = Array(daysInMonth).fill(0)
    const prevDailyCash = Array(daysInMonth).fill(0)

    currLeads.filter(l => Number(l.payment) > 0).forEach(l => {
      const d = l.call_at || l.date
      if (d) { const day = new Date(String(d)).getDate(); if (day >= 1 && day <= daysInMonth) dailyCash[day - 1] += Number(l.payment) || 0 }
    })
    const rawDailyCash = [...dailyCash]
    for (let i = 1; i < dailyCash.length; i++) dailyCash[i] += dailyCash[i - 1]

    prevLeadsData.filter(l => Number(l.payment) > 0).forEach(l => {
      const d = l.call_at || l.date
      if (d) { const day = new Date(String(d)).getDate(); if (day >= 1 && day <= daysInMonth) prevDailyCash[day - 1] += Number(l.payment) || 0 }
    })
    const rawPrevDailyCash = [...prevDailyCash]
    for (let i = 1; i < prevDailyCash.length; i++) prevDailyCash[i] += prevDailyCash[i - 1]

    // Previous cash at same day of month
    const dayNow = new Date().getDate()
    const prevCashAtDay = prevDailyCash[Math.min(dayNow - 1, prevDailyCash.length - 1)] || 0

    // Calls report — ALL leads with call_at
    const calls = currLeads
      .filter(l => l.call_at)
      .map(l => ({
        id: String(l.id || ''), date: String(l.call_at || ''), name: String(l.client_name || ''),
        revenue: Number(l.revenue) || 0, payment: Number(l.payment) || 0,
        program: String(l.program_purchased || l.program_offered || ''),
        closer: String(l.closer || ''), setter: String(l.setter || ''),
        status: String(l.status || ''), callLink: String(l.call_link || ''),
        closerReport: String(l.closer_report || ''), igHandle: String(l.ig_handle || ''),
        phone: String(l.phone || ''), entryChannel: String(l.entry_channel || ''),
        notes: String(l.notes || ''),
      }))
      .sort((a, b) => b.date.localeCompare(a.date))

    // Program counts
    const progMap: Record<string, number> = {}
    currLeads.filter(l => l.status === 'Cerrado' && l.program_purchased).forEach(l => {
      const p = String(l.program_purchased)
      progMap[p] = (progMap[p] || 0) + 1
    })
    const programCounts = Object.entries(progMap).map(([program, count]) => ({ program, count })).sort((a, b) => b.count - a.count)

    // Daily metrics for tooltip
    const metricsData = (metricsRes.data || []) as { date: string; conversaciones: number; agendas: number; cierres: number }[]
    const dailyChats = Array(daysInMonth).fill(0)
    const dailyAgendas = Array(daysInMonth).fill(0)
    const dailyCierres = Array(daysInMonth).fill(0)
    metricsData.forEach(row => {
      const day = new Date(String(row.date)).getDate()
      if (day >= 1 && day <= daysInMonth) {
        dailyChats[day - 1] = Number(row.conversaciones) || 0
        dailyAgendas[day - 1] = Number(row.agendas) || 0
        dailyCierres[day - 1] = Number(row.cierres) || 0
      }
    })

    setData({
      cash, prevCash, prevCashAtDay, chats, prevChats,
      reelsChats, historiasChats, bioChats,
      igCash, ytCash, refCash, defCash, bioCash, historiasCash, reelsCash,
      dailyCash, prevDailyCash, rawDailyCash, rawPrevDailyCash,
      dailyChats, dailyAgendas, dailyCierres,
      rawLeads: currLeads,
      rawContent: items.map((i: Record<string, unknown>) => ({ content_type: String(i.content_type), cash: Number(i.cash) || 0, chats: Number(i.chats) || 0, published_at: String(i.published_at || '') })),
      rawBio: bio.map((b: Record<string, unknown>) => ({ cash: Number(b.cash) || 0, chats: Number(b.chats) || 0 })),
      calls, programCounts,
      ventas: { cierres: currFunnel.cierres, cashCollected: currFunnel.ingresos, ticketPromedio: currFunnel.ticketPromedio, closeRate: currFunnel.closeRate, agendas: currFunnel.agendas, leads: currLeads.length },
    })
  }, [month, ready, supabase])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { setTfMonth(month); setTfProgram(''); setSelectedDay(null); setSelectedWeek(null) }, [month])
  useEffect(() => { setSelectedDay(null); setSelectedWeek(null) }, [view])
  useEffect(() => {
    setTypeform(null)
    const params = new URLSearchParams({ month: tfMonth })
    if (tfProgram) params.set('programa', tfProgram)
    fetch(`/api/typeform?${params}`).then(r => r.json()).then(d => { if (d.data) setTypeform(d) }).catch(() => {})
  }, [tfMonth, tfProgram])

  // Custom tooltip for line chart — refs MUST be before early return
  const chartTooltipRef = useRef<HTMLDivElement>(null)
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const tooltipDataRef = useRef<{ dayIndex: number } | null>(null)

  if (!data) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>

  const [y, m] = month.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const dayNow = new Date().getMonth() + 1 === m && new Date().getFullYear() === y ? new Date().getDate() : daysInMonth
  const cashPerDay = dayNow > 0 ? data.cash / dayNow : 0
  const projectedClose = Math.round(cashPerDay * daysInMonth)

  // Chart data
  const sparkDays = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const sparkCurrent = sparkDays.map((d, i) => d <= dayNow ? data.dailyCash[i] || 0 : null)
  const sparkPrev = data.prevDailyCash
  const sparkProj = sparkDays.map((d, i) => d >= dayNow ? Math.round(cashPerDay * d) : null)

  const cashTrend = data.prevCashAtDay > 0 ? ((data.cash - data.prevCashAtDay) / data.prevCashAtDay * 100) : 0

  // Weekly aggregation
  const weeksCount = Math.ceil(daysInMonth / 7)
  const weeklyLabels: string[] = []
  const weeklyCash: number[] = []
  const weeklyPrevCash: number[] = []
  for (let w = 0; w < weeksCount; w++) {
    const s = w * 7; const e = Math.min(s + 7, daysInMonth)
    weeklyLabels.push(`S${w + 1} (${s + 1}-${e})`)
    let wc = 0, wp = 0
    for (let d = s; d < e; d++) { wc += data.rawDailyCash[d] || 0; wp += data.rawPrevDailyCash[d] || 0 }
    weeklyCash.push(wc); weeklyPrevCash.push(wp)
  }

  // Current week index
  const currentWeekIdx = Math.min(Math.floor((dayNow - 1) / 7), weeksCount - 1)

  // === View-based filtering ===
  const getViewRange = () => {
    const pad = (n: number) => String(n).padStart(2, '0')
    if (view === 'diaria') {
      const day = selectedDay || dayNow
      const dayStr = `${y}-${pad(m)}-${pad(day)}`
      return { start: dayStr, end: dayStr, day }
    }
    if (view === 'semanal') {
      const wIdx = selectedWeek ?? currentWeekIdx
      const wg = weekGroups[wIdx]
      if (!wg) return null
      const startStr = `${y}-${pad(m)}-${pad(wg.startDay)}`
      const endStr = `${y}-${pad(m)}-${pad(wg.endDay)}`
      return { start: startStr, end: endStr, weekIdx: wIdx }
    }
    return null // mensual = no filter
  }

  // Week groups for filtering
  const weekGroups = (() => {
    const groups: { startDay: number; endDay: number }[] = []
    for (let i = 1; i <= daysInMonth; i += 7) {
      groups.push({ startDay: i, endDay: Math.min(i + 6, daysInMonth) })
    }
    return groups
  })()

  const viewRange = getViewRange()
  const viewLeads = viewRange
    ? data.rawLeads.filter(l => {
        const d = String(l.call_at || l.date || '')
        return d >= viewRange.start && d <= viewRange.end
      })
    : data.rawLeads

  // Recompute view-specific metrics
  const viewCash = viewLeads.filter(l => Number(l.payment) > 0).reduce((s, l) => s + (Number(l.payment) || 0), 0) + (viewRange ? 0 : data.defCash)

  // Attribute lead cash by agenda_point content type (what actually drove the sale)
  const classifyLeadSource = (l: LeadRow): string => {
    const ap = String(l.agenda_point || '').toLowerCase()
    const ef = String(l.entry_funnel || '').toLowerCase()
    const origin = String(l.origin || '').toLowerCase()
    // Check agenda_point first (last touchpoint before booking)
    if (ap.startsWith('historia')) return 'Historias'
    if (ap.startsWith('reel')) return 'Reels'
    if (ap === 'perfil') return 'Perfil'
    if (ap === 'referido' || ap.startsWith('referido')) return 'Referidos'
    // Fallback to entry_funnel
    if (ef.startsWith('historia')) return 'Historias'
    if (ef.startsWith('reel')) return 'Reels'
    if (ef === 'perfil') return 'Perfil'
    if (ef === 'referido' || ef.startsWith('referido')) return 'Referidos'
    // Fallback to origin/channel
    if (origin === 'referido') return 'Referidos'
    const ch = String(l.entry_channel || '').toLowerCase()
    if (ch === 'youtube') return 'YouTube'
    if (ch === 'referido') return 'Referidos'
    return 'Otros'
  }

  const viewCashBySource = (source: string) =>
    viewLeads.filter(l => classifyLeadSource(l) === source && Number(l.payment) > 0).reduce((s, l) => s + (Number(l.payment) || 0), 0)

  const viewHistoriasCashFromLeads = viewCashBySource('Historias')
  const viewReelsCashFromLeads = viewCashBySource('Reels')
  const viewPerfilCash = viewCashBySource('Perfil')
  const viewYtCash = viewCashBySource('YouTube')
  const viewRefCash = viewCashBySource('Referidos')
  const viewOtrosCash = viewCashBySource('Otros')

  const viewCalls = viewRange
    ? data.calls.filter(c => { const d = c.date.split('T')[0]; return d >= viewRange.start && d <= viewRange.end })
    : data.calls

  // Filter content by published_at date
  const viewContent = viewRange
    ? data.rawContent.filter(c => { const d = c.published_at.split('T')[0]; return d >= viewRange.start && d <= viewRange.end })
    : data.rawContent
  const viewBio = viewRange ? [] : data.rawBio // bio has no daily dates

  const viewReelsChats = viewContent.filter(c => c.content_type === 'reel').reduce((s, c) => s + c.chats, 0)
  const viewHistoriasChats = viewContent.filter(c => c.content_type === 'historia' || c.content_type === 'story').reduce((s, c) => s + c.chats, 0)
  const viewBioChats = viewBio.reduce((s, b) => s + b.chats, 0)
  const viewTotalChats = viewReelsChats + viewHistoriasChats + viewBioChats

  const viewReelsCash = viewContent.filter(c => c.content_type === 'reel').reduce((s, c) => s + c.cash, 0)
  const viewHistoriasCash = viewContent.filter(c => c.content_type === 'historia' || c.content_type === 'story').reduce((s, c) => s + c.cash, 0)
  const viewBioCash = viewBio.reduce((s, b) => s + b.cash, 0)

  // View period label
  const viewLabel = (() => {
    if (view === 'diaria') {
      const day = selectedDay || dayNow
      return `Dia ${day}`
    }
    if (view === 'semanal') {
      const wIdx = selectedWeek ?? currentWeekIdx
      const wg = weekGroups[wIdx]
      if (wg) return `Semana ${wIdx + 1} (${wg.startDay}-${wg.endDay})`
      return ''
    }
    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
    return `${monthNames[m - 1]} ${y}`
  })()

  // Donut sources — ALL from leads.payment attributed by agenda_point content type
  const viewDonutTotal = viewHistoriasCashFromLeads + viewReelsCashFromLeads + viewPerfilCash + viewYtCash + viewRefCash + viewOtrosCash
  const donutSources = [
    { label: 'Historias', value: viewHistoriasCashFromLeads, color: '#F59E0B' },
    { label: 'Reels', value: viewReelsCashFromLeads, color: '#3B82F6' },
    { label: 'Perfil', value: viewPerfilCash, color: '#8B5CF6' },
    { label: 'YouTube', value: viewYtCash, color: '#FF0000' },
    { label: 'Referidos', value: viewRefCash, color: '#22C55E' },
    { label: 'Otros', value: viewOtrosCash, color: '#6B7280' },
  ].filter(s => s.value > 0)

  const chatsSources = [
    { label: 'Historias', value: viewHistoriasChats, color: '#F59E0B', prevLabel: 'HISTORIAS' },
    { label: 'Reels', value: viewReelsChats, color: '#EF4444', prevLabel: 'REELS' },
    { label: 'BIO', value: viewBioChats, color: '#A855F7', prevLabel: 'BIO' },
  ]

  // CPC per channel — BIO = Perfil (same source)
  const viewBioCashReal = viewPerfilCash + viewBioCash
  const cpcReel = viewReelsChats > 0 ? viewReelsCashFromLeads / viewReelsChats : 0
  const cpcHistoria = viewHistoriasChats > 0 ? viewHistoriasCashFromLeads / viewHistoriasChats : 0
  const cpcBio = viewBioChats > 0 ? viewBioCashReal / viewBioChats : 0
  const contentCashTotal = viewReelsCashFromLeads + viewHistoriasCashFromLeads + viewBioCashReal
  const cpcTotal = viewTotalChats > 0 ? contentCashTotal / viewTotalChats : 0

  return (
    <div>
      {/* Header with tabs + month selector */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex gap-1">
          {(['diaria', 'semanal', 'mensual'] as const).map(v => (
            <button key={v} onClick={() => setView(v)} className={`px-4 py-2 rounded-lg text-[11px] font-semibold uppercase transition-colors ${view === v ? 'bg-[var(--accent)] text-white' : 'text-[var(--text3)] hover:text-[var(--text)]'}`}>
              Vista {v}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <MonthSelector month={month} options={options} onChange={setMonth} />
        </div>
      </div>

      {/* Row 1: Cash Collected + Origen del Cash */}
      <div className="grid grid-cols-5 gap-4 mb-4">
        {/* Cash Collected — 3 cols */}
        <div className="col-span-3 glass-card p-6 pb-5">
          {/* Header */}
          <div className="flex items-start justify-between mb-5">
            <div>
              <div className="font-mono-num text-[42px] font-bold text-[var(--green)] leading-none">{formatCash(viewCash)}</div>
              <div className="text-[11px] text-[var(--text3)] mt-1.5">{viewLabel}</div>
            </div>
            <div className="text-right flex flex-col items-end gap-1">
              {view === 'mensual' && (
                <div className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold ${cashTrend >= 0 ? 'bg-[rgba(34,197,94,0.1)] text-[var(--green)]' : 'bg-[rgba(248,113,113,0.1)] text-[#F87171]'}`}>
                  {cashTrend >= 0 ? '▲' : '▼'} {Math.abs(cashTrend).toFixed(0)}%
                </div>
              )}
              {view !== 'mensual' && (
                <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">{view === 'diaria' ? 'Cash por dia' : 'Cash por semana'}</div>
              )}
            </div>
          </div>

          {/* Chart */}
          {view === 'mensual' && (
            <div className="h-36 mb-3 relative" ref={chartContainerRef}
              onMouseLeave={() => { if (chartTooltipRef.current) chartTooltipRef.current.style.opacity = '0' }}>
              <Line data={{
                labels: sparkDays.map(d => String(d)),
                datasets: [
                  { data: sparkCurrent as (number | null)[], borderColor: '#22C55E', backgroundColor: 'rgba(34,197,94,0.08)', fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: '#22C55E', pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2, borderWidth: 2.5 },
                  { data: sparkPrev, borderColor: 'rgba(161,161,170,0.4)', borderDash: [5, 5], fill: false, tension: 0.4, pointRadius: 0, borderWidth: 1.5 },
                  { data: sparkProj as (number | null)[], borderColor: 'rgba(230,57,70,0.6)', borderDash: [4, 4], fill: false, tension: 0.4, pointRadius: 0, borderWidth: 1.5 },
                ],
              }} options={{
                responsive: true, maintainAspectRatio: false,
                scales: { x: { display: false }, y: { display: false } },
                plugins: {
                  tooltip: {
                    enabled: false,
                    external: (context: { tooltip: { opacity: number; dataPoints?: { dataIndex: number }[]; caretX: number; caretY: number } }) => {
                      const el = chartTooltipRef.current
                      if (!el) return
                      const { tooltip } = context
                      if (tooltip.opacity === 0 || !tooltip.dataPoints?.length) {
                        el.style.opacity = '0'; return
                      }
                      const i = tooltip.dataPoints[0].dataIndex
                      const left = tooltip.caretX > 400 ? tooltip.caretX - 200 : tooltip.caretX + 16
                      el.style.opacity = '1'
                      el.style.left = `${left}px`
                      el.style.top = `${Math.max(0, tooltip.caretY - 60)}px`
                      // Update content only if day changed
                      if (tooltipDataRef.current?.dayIndex !== i) {
                        tooltipDataRef.current = { dayIndex: i }
                        const cc = data.rawDailyCash[i] || 0
                        const chats = data.dailyChats[i] || 0
                        const agendas = data.dailyAgendas[i] || 0
                        const cierres = data.dailyCierres[i] || 0
                        el.innerHTML = `
                          <div class="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(8,8,12,0.96)] px-5 py-4 shadow-2xl backdrop-blur-sm" style="box-shadow:0 8px 32px rgba(0,0,0,0.5),0 0 0 1px rgba(255,255,255,0.05)">
                            <div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:12px">Día ${i + 1}</div>
                            <div style="display:flex;flex-direction:column;gap:10px">
                              <div style="display:flex;justify-content:space-between;gap:24px"><span style="font-size:12px;font-weight:500;color:#4ADE80">Cash collected</span><span style="font-size:13px;font-weight:700;color:#4ADE80;font-variant-numeric:tabular-nums">${formatCash(cc)}</span></div>
                              <div style="display:flex;justify-content:space-between;gap:24px"><span style="font-size:12px;font-weight:500;color:#60A5FA">Chats</span><span style="font-size:13px;font-weight:700;color:#fff;font-variant-numeric:tabular-nums">${chats}</span></div>
                              <div style="display:flex;justify-content:space-between;gap:24px"><span style="font-size:12px;font-weight:500;color:#FBBF24">Agendas</span><span style="font-size:13px;font-weight:700;color:#fff;font-variant-numeric:tabular-nums">${agendas}</span></div>
                              <div style="display:flex;justify-content:space-between;gap:24px"><span style="font-size:12px;font-weight:500;color:#E63946">Cierres</span><span style="font-size:13px;font-weight:700;color:#fff;font-variant-numeric:tabular-nums">${cierres}</span></div>
                            </div>
                          </div>`
                      }
                    },
                  },
                  legend: { display: false },
                },
                interaction: { intersect: false, mode: 'index' as const },
              }} />
              {/* Tooltip container — updated via ref, no React re-renders */}
              <div ref={chartTooltipRef} className="absolute z-50 pointer-events-none transition-opacity duration-150" style={{ opacity: 0 }} />
            </div>
          )}

          {view === 'diaria' && <CashBarChart
            labels={sparkDays.map(d => String(d))}
            values={sparkDays.map((d, i) => d <= dayNow ? data.rawDailyCash[i] || 0 : 0)}
            prevValues={data.rawPrevDailyCash}
            activeIndex={(() => { const d = selectedDay || dayNow; return d - 1 })()}
            onBarClick={(i) => { if (i + 1 <= dayNow) setSelectedDay(i + 1) }}
            compact
          />}

          {view === 'semanal' && <CashBarChart
            labels={weeklyLabels}
            values={weeklyCash}
            prevValues={weeklyPrevCash}
            activeIndex={selectedWeek ?? currentWeekIdx}
            onBarClick={(i) => setSelectedWeek(i)}
          />}

          {/* Legend */}
          <div className="flex items-center gap-5 text-[11px] mt-3 pt-3 border-t border-[var(--border)]">
            {view === 'mensual' ? (
              <>
                <div className="flex items-center gap-2">
                  <div className="h-[2px] w-5 rounded-full bg-[#22C55E]" />
                  <span className="text-[var(--text3)]">Actual</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-[2px] w-5 rounded-full" style={{ background: 'repeating-linear-gradient(90deg, #71717A 0 4px, transparent 4px 8px)' }} />
                  <span className="text-[var(--text3)]">Anterior</span>
                  <span className={`font-mono-num font-medium ${cashTrend >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>{formatCash(data.prevCashAtDay)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-[2px] w-5 rounded-full" style={{ background: 'repeating-linear-gradient(90deg, #E63946 0 3px, transparent 3px 7px)' }} />
                  <span className="text-[var(--text3)]">Proyeccion</span>
                  <span className="font-mono-num font-medium text-[var(--accent)]">{formatCash(projectedClose)}</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-2 rounded-sm bg-[var(--green)]" />
                  <span className="text-[var(--text3)]">Actual</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-2 rounded-sm bg-[rgba(82,82,91,0.4)]" />
                  <span className="text-[var(--text3)]">Anterior</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Origen del Cash — 2 cols */}
        <div className="col-span-2 glass-card p-6">
          <div className="text-[10px] text-[var(--text3)]">Distribucion del ingreso</div>
          <div className="text-[12px] font-semibold text-[var(--text)] mb-4">ORIGEN DEL CASH</div>
          <div className="flex items-center justify-center mb-4">
            <div className="relative w-44 h-44 -m-2" style={{ isolation: 'isolate', zIndex: 1, padding: 12 }}>
              <Doughnut data={{
                labels: donutSources.map(s => s.label),
                datasets: [{ data: donutSources.length > 0 ? donutSources.map(s => s.value) : [1], backgroundColor: donutSources.length > 0 ? donutSources.map(s => s.color) : ['#1E1E22'], borderWidth: 0, hoverBorderWidth: 2, hoverBorderColor: 'rgba(255,255,255,0.3)', hoverOffset: 6 }],
              }} options={{ responsive: true, maintainAspectRatio: true, cutout: '65%', layout: { padding: 14 }, animation: { duration: 600, easing: 'easeOutQuart' }, plugins: { legend: { display: false }, tooltip: { enabled: true, backgroundColor: 'rgba(0,0,0,0.85)', padding: 10, cornerRadius: 8 } } }} />
            </div>
          </div>
          <div className="space-y-1.5">
            {donutSources.map(s => {
              const pct = viewDonutTotal > 0 ? ((s.value / viewDonutTotal) * 100).toFixed(0) : '0'
              return (
                <div key={s.label} className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                    <span className="text-[var(--text2)]">{s.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono-num font-medium">{formatCash(s.value)}</span>
                    <span className="text-[var(--text3)] text-[10px]">{pct}%</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Row 2: Unified Chats + CPC Panel */}
      <div className="glass-card p-6 mb-4">
        {/* Top: Hero metrics */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Conversaciones {viewLabel}</div>
            <div className="text-[12px] font-semibold text-[var(--text)] mb-1">CHATS & CPC</div>
          </div>
          <div className="flex items-center gap-8">
            <div className="text-right">
              <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Total chats</div>
              <div className="font-mono-num text-4xl font-bold">{viewTotalChats}</div>
              {view === 'mensual' && data.prevChats > 0 && (
                <div className={`text-[11px] ${data.chats >= data.prevChats ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                  {data.chats >= data.prevChats ? '▲' : '▼'} {Math.abs(((data.chats - data.prevChats) / data.prevChats) * 100).toFixed(0)}% vs anterior
                </div>
              )}
            </div>
            <div className="text-right">
              <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">CPC promedio</div>
              <div className="font-mono-num text-4xl font-bold text-[var(--green)]">{formatCash(cpcTotal)}</div>
              <div className="text-[11px] text-[var(--text3)]">{formatCash(contentCashTotal)} / {viewTotalChats} chats</div>
            </div>
          </div>
        </div>

        {/* Middle: Donut + Table side by side */}
        <div className="flex items-center gap-6">
          {/* Donut */}
          <div className="relative w-36 h-36 flex-shrink-0" style={{ isolation: 'isolate', zIndex: 1 }}>
            <Doughnut data={{
              labels: chatsSources.map(s => s.label),
              datasets: [{ data: chatsSources.map(s => s.value || 0), backgroundColor: chatsSources.map(s => s.color), borderWidth: 0, hoverBorderWidth: 2, hoverBorderColor: 'rgba(255,255,255,0.3)', hoverOffset: 4 }],
            }} options={{ responsive: true, maintainAspectRatio: true, cutout: '62%', layout: { padding: 8 }, animation: { duration: 600, easing: 'easeOutQuart' }, plugins: { legend: { display: false }, tooltip: { enabled: true, backgroundColor: 'rgba(0,0,0,0.85)', padding: 10, cornerRadius: 8 } } }} />
          </div>

          {/* Table */}
          <div className="flex-1">
            <div className="grid grid-cols-5 gap-2 text-[9px] font-semibold uppercase tracking-wider text-[var(--text3)] mb-2 pb-1.5 border-b border-[var(--border)]">
              <div>Canal</div>
              <div className="text-right">Chats</div>
              <div className="text-right">%</div>
              <div className="text-right">Cash</div>
              <div className="text-right">CPC</div>
            </div>
            <div className="space-y-2.5">
              {[
                { label: 'Historias', chats: viewHistoriasChats, cash: viewHistoriasCashFromLeads, cpc: cpcHistoria, color: '#F59E0B' },
                { label: 'Reels', chats: viewReelsChats, cash: viewReelsCashFromLeads, cpc: cpcReel, color: '#EF4444' },
                { label: 'BIO / Perfil', chats: viewBioChats, cash: viewBioCashReal, cpc: cpcBio, color: '#A855F7' },
              ].map(ch => {
                const pct = viewTotalChats > 0 ? ((ch.chats / viewTotalChats) * 100).toFixed(0) : '0'
                return (
                  <div key={ch.label} className="grid grid-cols-5 gap-2 text-[12px] items-center">
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: ch.color }} />
                      <span className="font-medium">{ch.label}</span>
                    </div>
                    <span className="font-mono-num text-right">{ch.chats}</span>
                    <span className="font-mono-num text-right text-[var(--text3)]">{pct}%</span>
                    <span className="font-mono-num text-right text-[var(--green)]">{formatCash(ch.cash)}</span>
                    <span className="font-mono-num font-bold text-right">{formatCash(ch.cpc)}</span>
                  </div>
                )
              })}
            </div>
            {/* Stacked bar */}
            <div className="h-2 flex rounded-full overflow-hidden bg-[var(--bg4)] mt-4">
              {[
                { pct: viewHistoriasChats / Math.max(viewTotalChats, 1) * 100, color: '#F59E0B' },
                { pct: viewReelsChats / Math.max(viewTotalChats, 1) * 100, color: '#EF4444' },
                { pct: viewBioChats / Math.max(viewTotalChats, 1) * 100, color: '#A855F7' },
              ].map((b, i) => <div key={i} style={{ width: `${b.pct}%`, backgroundColor: b.color }} />)}
            </div>
          </div>
        </div>
      </div>

      {/* Row 3: Reporte de Calls + Onboarding */}
      <div className="grid grid-cols-2 gap-4">
        {/* Reporte de Calls */}
        <div className="glass-card p-6">
          <div className="text-[10px] text-[var(--text3)]">{view === 'diaria' ? 'Calls de hoy' : view === 'semanal' ? 'Calls de la semana' : 'Todas las calls del mes'}</div>
          <div className="text-[12px] font-semibold text-[var(--text)] mb-4">REPORTE DE LAS CALLS <span className="text-[10px] font-normal text-[var(--text3)]">({viewCalls.length})</span></div>
          {viewCalls.length > 0 ? (
            <CallsList calls={viewCalls} />
          ) : (
            <div className="text-[12px] text-[var(--text3)]">Sin calls {view === 'diaria' ? 'hoy' : view === 'semanal' ? 'esta semana' : 'este mes'}</div>
          )}
        </div>

        {/* Onboarding — Typeform data */}
        <div className="glass-card p-6">
          {/* Header with month selector */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[10px] text-[var(--text3)]">Datos del formulario de onboarding</div>
              <div className="text-[12px] font-semibold text-[var(--text)]">FORMULARIO DE ONBOARDING</div>
            </div>
            <MonthSelector month={tfMonth} options={options} onChange={setTfMonth} />
          </div>

          {typeform ? (
            <div className="space-y-5">
              {/* Program toggle pills */}
              {typeform.programs.length > 0 && (
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setTfProgram('')}
                    className={`px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide transition-all ${!tfProgram ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg3)] text-[var(--text3)] hover:text-[var(--text2)]'}`}
                  >Todos</button>
                  {typeform.programs.map(p => (
                    <button key={p} onClick={() => setTfProgram(p)}
                      className={`px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide transition-all ${tfProgram === p ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg3)] text-[var(--text3)] hover:text-[var(--text2)]'}`}
                    >{p}</button>
                  ))}
                </div>
              )}

              {/* KPI: Conviction gauge + Responses */}
              <div className="grid grid-cols-2 gap-3">
                <div className="relative p-4 rounded-xl bg-[var(--bg3)] flex flex-col items-center justify-center">
                  <div className="text-[9px] font-semibold uppercase text-[var(--text3)] mb-2">Prevendidos (1-10)</div>
                  <div className="relative w-20 h-20">
                    <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                      <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none" stroke="var(--bg4)" strokeWidth="3" />
                      <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none" stroke={typeform.avgConviction >= 7 ? 'var(--green)' : typeform.avgConviction >= 5 ? 'var(--amber)' : 'var(--accent)'}
                        strokeWidth="3" strokeDasharray={`${(typeform.avgConviction / 10) * 100}, 100`}
                        strokeLinecap="round" className="transition-all duration-700" />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="font-mono-num text-xl font-bold">{typeform.avgConviction || '—'}</span>
                    </div>
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-[var(--bg3)] flex flex-col items-center justify-center">
                  <div className="text-[9px] font-semibold uppercase text-[var(--text3)] mb-2">Respuestas</div>
                  <div className="font-mono-num text-3xl font-bold">{typeform.total}</div>
                  {typeform.totalAll !== typeform.total && (
                    <div className="text-[10px] text-[var(--text3)] mt-1">de {typeform.totalAll} totales</div>
                  )}
                </div>
              </div>

              {/* Tiempo de compra — horizontal bars */}
              {typeform.data.tiempoDecision?.length > 0 && (() => {
                const maxCount = Math.max(...typeform.data.tiempoDecision.map(t => t.count))
                const barColors = ['#22C55E', '#F59E0B', '#EF4444', '#A855F7', '#3B82F6']
                return (
                  <div>
                    <div className="text-[10px] font-semibold uppercase text-[var(--text3)] mb-2.5">Tiempo de compra</div>
                    <div className="space-y-2">
                      {typeform.data.tiempoDecision.map((t, i) => {
                        const pct = typeform.total > 0 ? (t.count / typeform.total) * 100 : 0
                        const barPct = maxCount > 0 ? (t.count / maxCount) * 100 : 0
                        return (
                          <div key={t.label}>
                            <div className="flex items-center justify-between text-[11px] mb-0.5">
                              <span className="text-[var(--text2)]">{t.label}</span>
                              <span className="font-mono-num text-[var(--text)]">{t.count} <span className="text-[var(--text3)]">({pct.toFixed(0)}%)</span></span>
                            </div>
                            <div className="h-2 rounded-full bg-[var(--bg4)] overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${barPct}%`, backgroundColor: barColors[i % barColors.length] }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}

              {/* Principales dolores — horizontal bars */}
              {typeform.data.problemas?.length > 0 && (() => {
                const items = typeform.data.problemas.slice(0, 5)
                const maxCount = Math.max(...items.map(p => p.count))
                return (
                  <div>
                    <div className="text-[10px] font-semibold uppercase text-[var(--text3)] mb-2.5">Principales dolores</div>
                    <div className="space-y-2">
                      {items.map(p => {
                        const pct = typeform.total > 0 ? (p.count / typeform.total) * 100 : 0
                        const barPct = maxCount > 0 ? (p.count / maxCount) * 100 : 0
                        return (
                          <div key={p.label}>
                            <div className="flex items-center justify-between text-[11px] mb-0.5">
                              <span className="text-[var(--text2)] truncate max-w-[220px]">{p.label}</span>
                              <span className="font-mono-num text-[var(--text)] shrink-0 ml-2">{p.count} <span className="text-[var(--text3)]">({pct.toFixed(0)}%)</span></span>
                            </div>
                            <div className="h-2 rounded-full bg-[var(--bg4)] overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-500 bg-[var(--accent)]" style={{ width: `${barPct}%`, opacity: 0.4 + (barPct / 100) * 0.6 }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}

              <div className="pt-2 border-t border-[var(--border)]">
                <a href="https://form.typeform.com/reports/01KEMVFP8RYCDTYP4WBKJ12ERK" target="_blank" rel="noopener noreferrer"
                  className="text-[10px] text-[var(--accent)] hover:underline">Ver reporte completo →</a>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              <div className="text-[11px] text-[var(--text3)] mt-3">Cargando datos de Typeform...</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function getPrevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

type CallItem = { id: string; date: string; name: string; revenue: number; payment: number; program: string; closer: string; setter: string; status: string; callLink: string; closerReport: string; igHandle: string; phone: string; entryChannel: string; notes: string }

function CallsList({ calls }: { calls: CallItem[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const statusColor = (s: string) => {
    if (s === 'Cerrado') return 'text-[var(--green)]'
    if (s === 'No show' || s === 'Descalificado') return 'text-[var(--red)]'
    if (s === 'Seguimiento') return 'text-[var(--amber)]'
    return 'text-[var(--text3)]'
  }

  return (
    <div className="space-y-1 max-h-[400px] overflow-y-auto">
      {calls.map(c => {
        const isExpanded = expandedId === c.id
        return (
          <div key={c.id} className={`rounded-lg transition-all ${isExpanded ? 'bg-[var(--bg3)] border border-[var(--border)]' : 'hover:bg-[var(--bg3)]'}`}>
            {/* Compact row */}
            <div className="flex items-center gap-3 px-3 py-2.5 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : c.id)}>
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: c.status === 'Cerrado' ? '#22C55E' : c.status === 'No show' ? '#EF4444' : '#F59E0B' }} />
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium truncate">{c.name || '—'}</div>
                <div className="text-[9px] text-[var(--text3)]">{c.date} · {c.closer}</div>
              </div>
              <div className={`text-[10px] font-semibold ${statusColor(c.status)}`}>{c.status}</div>
              {c.payment > 0 && <div className="font-mono-num text-[12px] font-bold text-[var(--green)]">{formatCash(c.payment)}</div>}
              <div className="text-[var(--text3)] text-[10px]">{isExpanded ? '▲' : '▼'}</div>
            </div>

            {/* Expanded details */}
            {isExpanded && (
              <div className="px-3 pb-3 space-y-3">
                {/* Call link */}
                {c.callLink && (
                  <a href={c.callLink} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--accent)] text-white text-[11px] font-semibold hover:opacity-90 w-fit">
                    🔗 Ver grabacion de la llamada
                  </a>
                )}

                {/* Lead info grid */}
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  {[
                    { label: 'Closer', value: c.closer },
                    { label: 'Setter', value: c.setter },
                    { label: 'Canal de entrada', value: c.entryChannel },
                    { label: 'Programa', value: c.program },
                    { label: 'Revenue', value: c.revenue > 0 ? formatCash(c.revenue) : '—' },
                    { label: 'Cobrado', value: c.payment > 0 ? formatCash(c.payment) : '—' },
                    { label: 'Instagram', value: c.igHandle ? `@${c.igHandle}` : '—' },
                    { label: 'Telefono', value: c.phone || '—' },
                    { label: 'Estado', value: c.status },
                  ].map(f => (
                    <div key={f.label}>
                      <div className="text-[9px] text-[var(--text3)] uppercase">{f.label}</div>
                      <div className="text-[var(--text)] font-medium">{f.value || '—'}</div>
                    </div>
                  ))}
                </div>

                {/* Closer report / notes */}
                {c.closerReport && (
                  <div>
                    <div className="text-[9px] font-semibold uppercase text-[var(--text3)] mb-1">Reporte del closer</div>
                    <div className="text-[11px] text-[var(--text2)] bg-[var(--bg4)] rounded-lg p-3 whitespace-pre-wrap">{c.closerReport}</div>
                  </div>
                )}
                {c.notes && !c.closerReport && (
                  <div>
                    <div className="text-[9px] font-semibold uppercase text-[var(--text3)] mb-1">Notas</div>
                    <div className="text-[11px] text-[var(--text2)] bg-[var(--bg4)] rounded-lg p-3">{c.notes}</div>
                  </div>
                )}

                {/* If not closed, show reason */}
                {c.status !== 'Cerrado' && !c.closerReport && !c.notes && (
                  <div className="text-[11px] text-[var(--text3)] italic">Sin reporte del closer</div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
