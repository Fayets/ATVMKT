'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useMonthContext } from '@/shared/components/app-providers'
import { MonthSelector } from '@/shared/components/month-selector'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { formatCash } from '@/shared/lib/format-utils'
import { apiFetch } from '@/lib/api'
import { Line, Doughnut, Bar } from '@/shared/components/charts'
import { calcFunnel, type LeadRow } from '@/features/leads/services/leads-analytics'
import type { DashContentRow, DashData } from './dashboard-data-types'

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

type BioMetrics = {
  total_leads: number
  agendaron: number
  cash_total: number
  cash_por_chat: number
  tasa_respuesta_auto: number | null
}

type LeadsMonthMetrics = Pick<BioMetrics, 'total_leads' | 'agendaron' | 'cash_total' | 'cash_por_chat'>

function asFiniteNumber(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** CTA / texto típico de bio IG (botón Info, información, enlace en perfil). */
function textLooksLikeBioTraffic(s: string): boolean {
  const t = String(s || '').trim().toLowerCase()
  if (!t) return false
  if (t.includes('información') || t.includes('informacion')) return true
  if (/\binfo\b/.test(t)) return true
  if ((t.includes('link') || t.includes('enlace')) && (t.includes('bio') || t.includes('biografía') || t.includes('perfil'))) return true
  if (t.includes('link en bio') || t.includes('link del perfil') || t.includes('desde perfil')) return true
  return false
}

/** Suma `amount` al bucket del día de publicación si cae en `year`–`month` (según fecha ISO YYYY-MM-DD). */
function addToMonthDayBucket(
  buckets: number[],
  year: number,
  month: number,
  publishedAt: string | undefined,
  amount: number,
) {
  if (!publishedAt || !amount) return
  const dayPart = String(publishedAt).slice(0, 10)
  const parts = dayPart.split('-')
  if (parts.length !== 3) return
  const py = Number(parts[0])
  const pm = Number(parts[1])
  const pd = Number(parts[2])
  if (py !== year || pm !== month || pd < 1 || pd > buckets.length) return
  buckets[pd - 1] += amount
}

function dashUserHeaders(userId: string): RequestInit {
  return { headers: { 'X-User-Id': userId } }
}

async function fetchReelsAsContent(monthKey: string, userId: string): Promise<DashContentRow[]> {
  const out: DashContentRow[] = []
  let page = 1
  const pageSize = 50
  for (;;) {
    const res = await apiFetch(
      `/reels?page=${page}&page_size=${pageSize}&month=${encodeURIComponent(monthKey)}`,
      dashUserHeaders(userId),
    )
    if (!res.ok) break
    const body = (await res.json().catch(() => ({}))) as {
      reels?: Array<{ cash?: number; chats?: number; published_at?: string | null }>
      total_pages?: number
    }
    const reels = body.reels ?? []
    for (const r of reels) {
      out.push({
        content_type: 'reel',
        cash: Number(r.cash) || 0,
        chats: Number(r.chats) || 0,
        published_at: r.published_at ? String(r.published_at) : '',
      })
    }
    const tp = Math.max(0, Number(body.total_pages) || 0)
    if (reels.length === 0) break
    if (tp > 0 && page >= tp) break
    if (reels.length < pageSize) break
    page += 1
  }
  return out
}

async function fetchLeadsForMonth(monthKey: string, userId: string): Promise<LeadRow[]> {
  try {
    const res = await apiFetch(`/leads?month=${encodeURIComponent(monthKey)}`, dashUserHeaders(userId))
    if (!res.ok) return []
    const body = (await res.json().catch(() => ({}))) as { leads?: unknown[] }
    return Array.isArray(body.leads) ? (body.leads as LeadRow[]) : []
  } catch {
    return []
  }
}

/** Día YYYY-MM-DD para filtrar vistas diaria/semana (el API suele dejar `call_at` vacío). */
function leadDayForFilter(l: LeadRow): string {
  for (const key of ['call_at', 'scheduled_at', 'agendo', 'fecha_bot', 'first_contact_at', 'date'] as const) {
    const v = l[key]
    if (v == null || v === '') continue
    const s = String(v).trim().slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  }
  return ''
}

function emptyDashForMonth(month: string): DashData {
  const [y, m] = month.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const z = () => Array(daysInMonth).fill(0)
  return {
    cash: 0,
    prevCash: 0,
    prevCashAtDay: 0,
    chats: 0,
    prevChats: 0,
    reelsChats: 0,
    historiasChats: 0,
    bioChats: 0,
    igCash: 0,
    ytCash: 0,
    refCash: 0,
    defCash: 0,
    bioCash: 0,
    historiasCash: 0,
    reelsCash: 0,
    dailyCash: z(),
    prevDailyCash: z(),
    rawDailyCash: z(),
    rawPrevDailyCash: z(),
    dailyChats: z(),
    dailyAgendas: z(),
    dailyCierres: z(),
    rawLeads: [],
    rawContent: [],
    rawBio: [],
    calls: [],
    programCounts: [],
    ventas: {
      cierres: 0,
      cashCollected: 0,
      ticketPromedio: 0,
      closeRate: 0,
      agendas: 0,
      leads: 0,
    },
  }
}

export default function DashboardPage() {
  const { month, options, setMonth } = useMonthContext()
  const { ready, userId } = useAuthUser()
  const [data, setData] = useState<DashData | null>(null)
  const [bioMetrics, setBioMetrics] = useState<BioMetrics | null>(null)
  const [leadsMonthMetrics, setLeadsMonthMetrics] = useState<LeadsMonthMetrics | null>(null)
  const [loadingLeadsMonthMetrics, setLoadingLeadsMonthMetrics] = useState(false)
  const [view, setView] = useState<'mensual' | 'semanal' | 'diaria'>('mensual')
  const [selectedDay, setSelectedDay] = useState<number | null>(null)   // 1-based day of month
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null) // 0-based week index
  const [typeform, setTypeform] = useState<TypeformData | null>(null)
  const [tfMonth, setTfMonth] = useState(month)
  const [tfProgram, setTfProgram] = useState<string>('')
  const apiBase =
    (process.env.NEXT_PUBLIC_BACKEND_URL || '').trim().replace(/\/$/, '') || '/api-backend'

  const fetchData = useCallback(async () => {
    if (!ready) return
    if (!userId) {
      setData(emptyDashForMonth(month))
      return
    }

    const prev = getPrevMonth(month)

    let items: Record<string, unknown>[] = []
    let pItems: Record<string, unknown>[] = []
    let currLeads: LeadRow[] = []
    let prevLeadsData: LeadRow[] = []
    const settled = await Promise.allSettled([
      fetchReelsAsContent(month, userId),
      fetchReelsAsContent(prev, userId),
      fetchLeadsForMonth(month, userId),
      fetchLeadsForMonth(prev, userId),
    ])
    const currRows = settled[0].status === 'fulfilled' ? settled[0].value : []
    const prevRows = settled[1].status === 'fulfilled' ? settled[1].value : []
    currLeads = settled[2].status === 'fulfilled' ? settled[2].value : []
    prevLeadsData = settled[3].status === 'fulfilled' ? settled[3].value : []
    items = currRows as unknown as Record<string, unknown>[]
    pItems = prevRows as unknown as Record<string, unknown>[]

    const bio: Record<string, unknown>[] = []
    const def_: Record<string, unknown>[] = []
    const metricsRes = { data: [] as Record<string, unknown>[] }
    const sum = (arr: Record<string, unknown>[], key: string) => arr.reduce((s, i) => s + (Number(i[key]) || 0), 0)
    const byType = (type: string) => items.filter((i: Record<string, unknown>) => i.content_type === type || (type === 'historia' && i.content_type === 'story'))

    const reelsChats = sum(byType('reel'), 'chats')
    const historiasChats = sum(byType('historia'), 'chats')
    const bioChats = sum(bio, 'chats')
    const contentChatsTotal = reelsChats + historiasChats + bioChats
    const chats = currLeads.length > 0 ? currLeads.length : contentChatsTotal

    // Leads (currLeads / prevLeadsData cargados arriba)
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
    const leadCashTotal = currFunnel.ingresos + defCash
    const contentCashTotal = reelsCash + historiasCash + bioCash
    const cash = leadCashTotal > 0 ? leadCashTotal : contentCashTotal

    const byTypePrev = (type: string) =>
      pItems.filter((i: Record<string, unknown>) => i.content_type === type || (type === 'historia' && i.content_type === 'story'))
    const prevReelsCash = sum(byTypePrev('reel'), 'cash')
    const prevHistoriasCash = sum(byTypePrev('historia'), 'cash')
    const prevBioCash = 0
    const prevLeadCash = prevFunnel.ingresos
    const prevContentCash = prevReelsCash + prevHistoriasCash + prevBioCash
    const prevCash = prevLeadCash > 0 ? prevLeadCash : prevContentCash
    const prevContentChats = sum(pItems, 'chats')
    const prevChats = prevLeadsData.length > 0 ? prevLeadsData.length : prevContentChats

    // Daily cash from leads (by payment date or call_at)
    const [y, m] = month.split('-').map(Number)
    const daysInMonth = new Date(y, m, 0).getDate()
    const [py, pm] = prev.split('-').map(Number)
    const dailyCash = Array(daysInMonth).fill(0)
    const prevDailyCash = Array(daysInMonth).fill(0)

    currLeads.filter(l => Number(l.payment) > 0).forEach(l => {
      const d = l.call_at || l.date
      if (d) { const day = new Date(String(d)).getDate(); if (day >= 1 && day <= daysInMonth) dailyCash[day - 1] += Number(l.payment) || 0 }
    })
    if (leadCashTotal <= 0) {
      items.forEach((row: Record<string, unknown>) => {
        addToMonthDayBucket(dailyCash, y, m, String(row.published_at || ''), Number(row.cash) || 0)
      })
    }
    const rawDailyCash = [...dailyCash]
    for (let i = 1; i < dailyCash.length; i++) dailyCash[i] += dailyCash[i - 1]

    prevLeadsData.filter(l => Number(l.payment) > 0).forEach(l => {
      const d = l.call_at || l.date
      if (d) { const day = new Date(String(d)).getDate(); if (day >= 1 && day <= daysInMonth) prevDailyCash[day - 1] += Number(l.payment) || 0 }
    })
    if (prevLeadCash <= 0) {
      pItems.forEach((row: Record<string, unknown>) => {
        addToMonthDayBucket(prevDailyCash, py, pm, String(row.published_at || ''), Number(row.cash) || 0)
      })
    }
    const rawPrevDailyCash = [...prevDailyCash]
    for (let i = 1; i < prevDailyCash.length; i++) prevDailyCash[i] += prevDailyCash[i - 1]

    // Previous cash at same day of month
    const dayNow = new Date().getDate()
    const prevCashAtDay = prevDailyCash[Math.min(dayNow - 1, prevDailyCash.length - 1)] || 0

    // Calls report — fecha de llamada agendada (call_at legacy o scheduled_at / columna call en BD)
    const calls = currLeads
      .filter(l => l.call_at || l.scheduled_at)
      .map(l => ({
        id: String(l.id || ''),
        date: String(l.call_at || l.scheduled_at || ''),
        name: String(l.client_name || ''),
        revenue: Number(l.revenue) || 0, payment: Number(l.payment) || 0,
        program: String(l.program_offered || ''),
        closer: String(l.closer || ''), setter: String(l.setter || ''),
        status: String(l.status || ''), callLink: String(l.call_link || ''),
        closerReport: String(l.closer_report || ''), igHandle: String(l.ig_handle || ''),
        phone: String(l.phone || ''), entryChannel: String(l.entry_channel || ''),
        notes: String(l.notes || ''),
      }))
      .sort((a, b) => b.date.localeCompare(a.date))

    // Program counts
    const progMap: Record<string, number> = {}
    currLeads.filter(l => l.status === 'Cerrado' && l.program_offered).forEach(l => {
      const p = String(l.program_offered)
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
    if (!metricsData.length) {
      items.forEach((row: Record<string, unknown>) => {
        addToMonthDayBucket(dailyChats, y, m, String(row.published_at || ''), Number(row.chats) || 0)
      })
    }

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
      ventas: {
        cierres: currFunnel.cierres,
        cashCollected: leadCashTotal > 0 ? currFunnel.ingresos : contentCashTotal,
        ticketPromedio: currFunnel.ticketPromedio,
        closeRate: currFunnel.closeRate,
        agendas: currFunnel.agendas,
        leads: currLeads.length,
      },
    })
  }, [month, ready, userId])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => {
    if (!ready || !userId) return
    const loadBioMetrics = async () => {
      try {
        const res = await fetch(`${apiBase}/api/bio/metrics?month=${encodeURIComponent(month)}`, {
          headers: { 'X-User-Id': userId },
        })
        const txt = await res.text()
        const payload = (() => {
          try { return txt ? JSON.parse(txt) : {} } catch { return {} }
        })() as Partial<BioMetrics>
        if (!res.ok) {
          setBioMetrics(null)
          return
        }
        setBioMetrics({
          total_leads: asFiniteNumber(payload.total_leads),
          agendaron: asFiniteNumber(payload.agendaron),
          cash_total: asFiniteNumber(payload.cash_total),
          cash_por_chat: asFiniteNumber(payload.cash_por_chat),
          tasa_respuesta_auto:
            payload.tasa_respuesta_auto === null || payload.tasa_respuesta_auto === undefined
              ? null
              : asFiniteNumber(payload.tasa_respuesta_auto),
        })
      } catch {
        setBioMetrics(null)
      }
    }
    loadBioMetrics()
  }, [apiBase, month, ready, userId])
  useEffect(() => {
    if (!ready || !userId) {
      setLeadsMonthMetrics(null)
      return
    }
    const load = async () => {
      setLoadingLeadsMonthMetrics(true)
      try {
        const res = await apiFetch(`/leads/metrics?month=${encodeURIComponent(month)}`)
        const txt = await res.text()
        const payload = (() => {
          try { return txt ? JSON.parse(txt) : {} } catch { return {} }
        })() as Partial<LeadsMonthMetrics>
        if (!res.ok) {
          setLeadsMonthMetrics(null)
          return
        }
        setLeadsMonthMetrics({
          total_leads: asFiniteNumber(payload.total_leads),
          agendaron: asFiniteNumber(payload.agendaron),
          cash_total: asFiniteNumber(payload.cash_total),
          cash_por_chat: asFiniteNumber(payload.cash_por_chat),
        })
      } catch {
        setLeadsMonthMetrics(null)
      } finally {
        setLoadingLeadsMonthMetrics(false)
      }
    }
    load()
  }, [month, ready, userId])
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

  const dashData = data
  const bioDisplay = bioMetrics

  const [y, m] = month.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const dayNow = new Date().getMonth() + 1 === m && new Date().getFullYear() === y ? new Date().getDate() : daysInMonth
  const cashPerDay = dayNow > 0 ? dashData.cash / dayNow : 0
  const projectedClose = Math.round(cashPerDay * daysInMonth)

  // Chart data
  const sparkDays = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const sparkCurrent = sparkDays.map((d, i) => d <= dayNow ? dashData.dailyCash[i] || 0 : null)
  const sparkPrev = dashData.prevDailyCash
  const sparkProj = sparkDays.map((d, i) => d >= dayNow ? Math.round(cashPerDay * d) : null)

  const cashTrend = dashData.prevCashAtDay > 0 ? ((dashData.cash - dashData.prevCashAtDay) / dashData.prevCashAtDay * 100) : 0

  // Weekly aggregation
  const weeksCount = Math.ceil(daysInMonth / 7)
  const weeklyLabels: string[] = []
  const weeklyCash: number[] = []
  const weeklyPrevCash: number[] = []
  for (let w = 0; w < weeksCount; w++) {
    const s = w * 7; const e = Math.min(s + 7, daysInMonth)
    weeklyLabels.push(`S${w + 1} (${s + 1}-${e})`)
    let wc = 0, wp = 0
    for (let d = s; d < e; d++) { wc += dashData.rawDailyCash[d] || 0; wp += dashData.rawPrevDailyCash[d] || 0 }
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
    ? dashData.rawLeads.filter(l => {
        const d = leadDayForFilter(l)
        return d.length >= 10 && d >= viewRange.start && d <= viewRange.end
      })
    : dashData.rawLeads

  // Attribute lead cash by agenda_point content type (what actually drove the sale)
  const classifyLeadSource = (l: LeadRow): string => {
    const url = String(l.content_url || '').toLowerCase()
    if (url.includes('/reel/') || url.includes('instagram.com/reel')) return 'Reels'
    const chEarly = String(l.entry_channel || '').toLowerCase()
    if (chEarly.includes('reel') || chEarly.includes('reels')) return 'Reels'
    if (chEarly.includes('historia') || chEarly.includes('story')) return 'Historias'
    if (chEarly.includes('perfil') || chEarly.includes('bio')) return 'Perfil'
    if (textLooksLikeBioTraffic(chEarly)) return 'Perfil'
    const ap = String(l.agenda_point || '').toLowerCase()
    const ef = String(l.entry_funnel || '').toLowerCase()
    const origin = String(l.origin || '').toLowerCase()
    const kwField = String(l.keyword || '').toLowerCase()
    // Check agenda_point first (last touchpoint before booking)
    if (ap.startsWith('historia')) return 'Historias'
    if (ap.startsWith('reel')) return 'Reels'
    if (textLooksLikeBioTraffic(ap)) return 'Perfil'
    if (ap === 'perfil') return 'Perfil'
    if (ap === 'referido' || ap.startsWith('referido')) return 'Referidos'
    // Fallback to entry_funnel
    if (ef.startsWith('historia')) return 'Historias'
    if (ef.startsWith('reel')) return 'Reels'
    if (textLooksLikeBioTraffic(ef)) return 'Perfil'
    if (ef === 'perfil') return 'Perfil'
    if (ef === 'referido' || ef.startsWith('referido')) return 'Referidos'
    if (textLooksLikeBioTraffic(kwField)) return 'Perfil'
    // Fallback to origin/channel
    if (origin === 'referido') return 'Referidos'
    if (textLooksLikeBioTraffic(origin)) return 'Perfil'
    const ch = String(l.entry_channel || '').toLowerCase()
    if (ch === 'youtube') return 'YouTube'
    if (ch === 'referido') return 'Referidos'
    return 'Otros'
  }

  /** Una fila por lead en la tabla de 3 canales (Referidos/Otros → Reels). */
  const dashboardChatBucket = (l: LeadRow): 'Historias' | 'Reels' | 'Perfil' => {
    const s = classifyLeadSource(l)
    if (s === 'Historias') return 'Historias'
    if (s === 'Perfil') return 'Perfil'
    if (s === 'Reels' || s === 'YouTube') return 'Reels'
    return 'Reels'
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
    ? dashData.calls.filter(c => { const d = c.date.split('T')[0]; return d >= viewRange.start && d <= viewRange.end })
    : dashData.calls

  // Filter content by published_at date
  const viewContent = viewRange
    ? dashData.rawContent.filter(c => { const d = c.published_at.split('T')[0]; return d >= viewRange.start && d <= viewRange.end })
    : dashData.rawContent
  const viewBio = viewRange ? [] : dashData.rawBio // bio has no daily dates

  const leadChatsHistorias = viewLeads.filter(l => dashboardChatBucket(l) === 'Historias').length
  const leadChatsReels = viewLeads.filter(l => dashboardChatBucket(l) === 'Reels').length
  const leadChatsPerfil = viewLeads.filter(l => dashboardChatBucket(l) === 'Perfil').length

  const viewReelsChatsContent = viewContent.filter(c => c.content_type === 'reel').reduce((s, c) => s + c.chats, 0)
  const viewHistoriasChatsContent = viewContent.filter(c => c.content_type === 'historia' || c.content_type === 'story').reduce((s, c) => s + c.chats, 0)
  const viewBioChatsFromSupabase = viewBio.reduce((s, b) => s + b.chats, 0)
  const viewBioChatsFallback = (!viewRange && viewBioChatsFromSupabase <= 0 && bioDisplay)
    ? bioDisplay.total_leads
    : viewBioChatsFromSupabase

  // Con CRM en la vista: un lead = un solo canal (no mezclar con chats agregados de IG en piezas).
  // Math.max(reels, contenido) inflaba Reels cuando IG sumaba más conversaciones que leads en bucket Reels.
  const hasLeadsInView = viewLeads.length > 0
  const viewReelsChats = hasLeadsInView ? leadChatsReels : viewReelsChatsContent
  const viewHistoriasChats = hasLeadsInView ? leadChatsHistorias : viewHistoriasChatsContent
  const viewBioChats = hasLeadsInView ? leadChatsPerfil : viewBioChatsFallback
  const viewTotalChatsFromChannels = viewReelsChats + viewHistoriasChats + viewBioChats
  const viewTotalChats = viewTotalChatsFromChannels

  const viewReelsCash = viewContent.filter(c => c.content_type === 'reel').reduce((s, c) => s + c.cash, 0)
  const viewHistoriasCash = viewContent.filter(c => c.content_type === 'historia' || c.content_type === 'story').reduce((s, c) => s + c.cash, 0)
  const viewBioCashFromSupabase = viewBio.reduce((s, b) => s + b.cash, 0)
  const viewBioCash = (!viewRange && viewBioCashFromSupabase <= 0 && bioDisplay)
    ? asFiniteNumber(bioDisplay.cash_total)
    : asFiniteNumber(viewBioCashFromSupabase)

  const leadPayInView = viewLeads.filter(l => Number(l.payment) > 0).reduce((s, l) => s + (Number(l.payment) || 0), 0)
  const defPart = viewRange ? 0 : dashData.defCash
  const fromLeadsCash = leadPayInView + defPart
  const fromContentCash = viewReelsCash + viewHistoriasCash + viewBioCash
  const viewCash = fromLeadsCash > 0 ? fromLeadsCash : fromContentCash

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

  // Donut: lead attribution; si no hay CRM, usar cash por pieza (contenido) + bio
  const donutHistoriasVal = viewHistoriasCashFromLeads || viewHistoriasCash
  const donutReelsVal = viewReelsCashFromLeads || viewReelsCash
  const donutPerfilVal = viewPerfilCash || viewBioCash
  const viewDonutTotal =
    donutHistoriasVal + donutReelsVal + donutPerfilVal + viewYtCash + viewRefCash + viewOtrosCash
  const donutSources = [
    { label: 'Historias', value: donutHistoriasVal, color: '#F59E0B' },
    { label: 'Reels', value: donutReelsVal, color: '#3B82F6' },
    { label: 'Perfil', value: donutPerfilVal, color: '#8B5CF6' },
    { label: 'YouTube', value: viewYtCash, color: '#FF0000' },
    { label: 'Referidos', value: viewRefCash, color: '#22C55E' },
    { label: 'Otros', value: viewOtrosCash, color: '#6B7280' },
  ].filter(s => s.value > 0)

  const chatsSources = [
    { label: 'Historias', value: viewHistoriasChats, color: '#F59E0B', prevLabel: 'HISTORIAS' },
    { label: 'Reels', value: viewReelsChats, color: '#EF4444', prevLabel: 'REELS' },
    { label: 'BIO', value: viewBioChats, color: '#A855F7', prevLabel: 'BIO' },
  ]

  const cashByChatBucket = (bucket: 'Historias' | 'Reels' | 'Perfil') =>
    asFiniteNumber(
      viewLeads.filter(l => dashboardChatBucket(l) === bucket).reduce((s, l) => s + (Number(l.payment) || 0), 0),
    )

  // CPC per channel — mismo bucket que CHATS; fallback a atribución fina / piezas
  const viewBioCashReal =
    asFiniteNumber(cashByChatBucket('Perfil') || viewPerfilCash) + asFiniteNumber(viewBioCash)
  const reelCashForCpc = cashByChatBucket('Reels') || viewReelsCashFromLeads || viewReelsCash
  const histCashForCpc = cashByChatBucket('Historias') || viewHistoriasCashFromLeads || viewHistoriasCash
  const cpcReel = viewReelsChats > 0 ? reelCashForCpc / viewReelsChats : 0
  const cpcHistoria = viewHistoriasChats > 0 ? histCashForCpc / viewHistoriasChats : 0
  const cpcBio = viewBioChats > 0 ? asFiniteNumber(viewBioCashReal / viewBioChats) : 0
  const contentCashTotal = asFiniteNumber(reelCashForCpc) + asFiniteNumber(histCashForCpc) + asFiniteNumber(viewBioCashReal)
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

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
        <div className="glass-card p-4">
          <div className="text-[11px] font-medium text-[var(--text3)] tracking-tight">Leads</div>
          <div className="font-mono-num mt-1 text-2xl font-bold">
            {loadingLeadsMonthMetrics ? '—' : (leadsMonthMetrics?.total_leads ?? 0)}
          </div>
        </div>
        <div className="glass-card p-4">
          <div className="text-[11px] font-medium text-[var(--text3)] tracking-tight">Tasa de agenda</div>
          <div className="font-mono-num mt-1 text-2xl font-bold">
            {loadingLeadsMonthMetrics ? '—' : (() => {
              const leads = leadsMonthMetrics?.total_leads ?? 0
              const agendaron = leadsMonthMetrics?.agendaron ?? 0
              if (leads <= 0) return '—'
              return `${((agendaron / leads) * 100).toFixed(1)}%`
            })()}
          </div>
        </div>
        <div className="glass-card p-4">
          <div className="text-[11px] font-medium text-[var(--text3)] tracking-tight">Cash por chat</div>
          <div className="font-mono-num mt-1 text-2xl font-bold">
            {loadingLeadsMonthMetrics ? '—' : formatCash(Number(leadsMonthMetrics?.cash_por_chat || 0))}
          </div>
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
                        const cc = dashData.rawDailyCash[i] || 0
                        const chats = dashData.dailyChats[i] || 0
                        const agendas = dashData.dailyAgendas[i] || 0
                        const cierres = dashData.dailyCierres[i] || 0
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
            values={sparkDays.map((d, i) => d <= dayNow ? dashData.rawDailyCash[i] || 0 : 0)}
            prevValues={dashData.rawPrevDailyCash}
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
                  <span className={`font-mono-num font-medium ${cashTrend >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>{formatCash(dashData.prevCashAtDay)}</span>
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
              {view === 'mensual' && dashData.prevChats > 0 && (
                <div className={`text-[11px] ${dashData.chats >= dashData.prevChats ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                  {dashData.chats >= dashData.prevChats ? '▲' : '▼'} {Math.abs(((dashData.chats - dashData.prevChats) / dashData.prevChats) * 100).toFixed(0)}% vs anterior
                </div>
              )}
            </div>
            <div className="text-right">
              <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">CPC promedio</div>
              <div className="font-mono-num text-4xl font-bold text-[var(--green)]">{formatCash(cpcTotal)}</div>
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
                { label: 'Historias', chats: viewHistoriasChats, cash: histCashForCpc, cpc: cpcHistoria, color: '#F59E0B' },
                { label: 'Reels', chats: viewReelsChats, cash: reelCashForCpc, cpc: cpcReel, color: '#EF4444' },
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

    </div>
  )
}

function getPrevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

