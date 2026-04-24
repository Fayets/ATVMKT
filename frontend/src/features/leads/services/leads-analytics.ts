import { getMonthRange } from '@/shared/lib/supabase/queries'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TYPES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type LeadRow = Record<string, unknown>

export type LeadsFunnel = {
  conversaciones: number
  agendas: number
  shows: number
  noShows: number
  cierres: number
  ingresos: number       // cash collected (payment)
  facturacion: number    // total revenue billed
  ticketPromedio: number
  closeRate: number
  showUpRate: number
  tasaAgendamiento: number
  cashPorAgenda: number
  cashPorShow: number
  aov: number            // average order value (facturacion / cierres)
}

export type WeekMetrics = {
  agendas: number[]
  conversaciones: number[]
  shows: number[]
  cierres: number[]
  ingresos: number[]
  noShows: number[]
}

export type LeadsAnalytics = LeadsFunnel & {
  programas: { nombre: string; ventas: number; ingresos: number }[]
  byWeek: WeekMetrics
  byWeekDay: { [K in keyof WeekMetrics]: number[][] } // [4 weeks][7 days]
}

export type MemberMetrics = LeadsFunnel & {
  name: string
  leads: LeadRow[]
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CORE CALCULATIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function calcFunnel(leads: LeadRow[], conversaciones?: number): LeadsFunnel {
  const cerrados = leads.filter(l => l.status === 'Cerrado')
  const agendas = leads.filter(l => l.scheduled_at || l.call_at).length
  const noShows = leads.filter(l => l.status === 'No show').length
  const shows = Math.max(0, agendas - noShows)
  const cierres = cerrados.length
  const ingresos = leads.reduce((s, l) => s + (Number(l.payment) || 0), 0)
  const facturacion = leads.reduce((s, l) => s + (Number(l.revenue) || 0), 0)
  const conv = conversaciones ?? leads.length

  return {
    conversaciones: conv,
    agendas, shows, noShows, cierres, ingresos, facturacion,
    ticketPromedio: cierres > 0 ? ingresos / cierres : 0,
    closeRate: shows > 0 ? (cierres / shows) * 100 : 0,
    showUpRate: agendas > 0 ? ((agendas - noShows) / agendas) * 100 : 0,
    tasaAgendamiento: conv > 0 ? (agendas / conv) * 100 : 0,
    cashPorAgenda: agendas > 0 ? ingresos / agendas : 0,
    cashPorShow: shows > 0 ? ingresos / shows : 0,
    aov: cierres > 0 ? facturacion / cierres : 0,
  }
}

export function distribute(total: number, n: number): number[] {
  const arr: number[] = []
  const base = Math.floor(total / n)
  const rem = total - base * n
  for (let i = 0; i < n; i++) arr.push(base + (i < rem ? 1 : 0))
  return arr
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FULL ANALYTICS (for sales-dashboard)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function getLeadsAnalytics(
  supabase: { from: (table: string) => { select: (fields?: string) => { eq: (field: string, value: string) => Promise<{ data: Record<string, unknown>[] }> } } },
  month: string
): Promise<{ leads: LeadRow[]; analytics: LeadsAnalytics; conversaciones: number }> {
  const { start, end } = getMonthRange(month)

  const [leadsRes, dailySetterRes, dailyCloserRes] = await Promise.all([
    supabase.from('leads').select('*').eq('month', month),
    supabase.from('daily_reports').select('*').eq('role', 'setter').eq('month', month),
    supabase.from('daily_reports').select('*').eq('role', 'closer').eq('month', month),
  ])

  const leads = (leadsRes.data || []) as LeadRow[]
  const setterReports = dailySetterRes.data || []
  const closerReports = dailyCloserRes.data || []

  // Fuente de datos: daily_reports del setter y closer
  const sumField = (reports: Record<string, unknown>[], field: string) =>
    reports.reduce((s, r) => s + (Number(r[field]) || 0), 0)

  const conversaciones = sumField(setterReports, 'conversaciones')
  const agendas = sumField(setterReports, 'agendas')
  const shows = sumField(closerReports, 'shows')
  const cierres = sumField(closerReports, 'cierres')
  const ingresos = sumField(closerReports, 'ingreso')
  const noShows = Math.max(0, agendas - shows)

  const funnel: LeadsFunnel = {
    conversaciones,
    agendas,
    shows,
    noShows,
    cierres,
    ingresos,
    facturacion: ingresos,
    ticketPromedio: cierres > 0 ? ingresos / cierres : 0,
    closeRate: shows > 0 ? (cierres / shows) * 100 : 0,
    showUpRate: agendas > 0 ? (shows / agendas) * 100 : 0,
    tasaAgendamiento: conversaciones > 0 ? (agendas / conversaciones) * 100 : 0,
    cashPorAgenda: agendas > 0 ? ingresos / agendas : 0,
    cashPorShow: shows > 0 ? ingresos / shows : 0,
    aov: cierres > 0 ? ingresos / cierres : 0,
  }

  // Programs breakdown (from leads table)
  const progMap: Record<string, { ventas: number; ingresos: number }> = {}
  leads.forEach(l => {
    const p = l.program_purchased as string
    if (p) {
      progMap[p] = progMap[p] || { ventas: 0, ingresos: 0 }
      progMap[p].ventas++
      progMap[p].ingresos += Number(l.payment) || 0
    }
  })
  const programas = Object.entries(progMap)
    .map(([nombre, v]) => ({ nombre, ...v }))
    .sort((a, b) => b.ingresos - a.ingresos)

  // Weekly + daily distributions from daily_reports by actual date
  const allReports = [...setterReports, ...closerReports]
  const byWeek: WeekMetrics = { agendas: [0,0,0,0], conversaciones: [0,0,0,0], shows: [0,0,0,0], cierres: [0,0,0,0], ingresos: [0,0,0,0], noShows: [0,0,0,0] }
  const z7 = () => [0,0,0,0,0,0,0]
  const byWeekDay: LeadsAnalytics['byWeekDay'] = {
    conversaciones: [z7(),z7(),z7(),z7()], agendas: [z7(),z7(),z7(),z7()],
    shows: [z7(),z7(),z7(),z7()], cierres: [z7(),z7(),z7(),z7()],
    ingresos: [z7(),z7(),z7(),z7()], noShows: [z7(),z7(),z7(),z7()],
  }

  allReports.forEach((r: Record<string, unknown>) => {
    const date = new Date((r.date as string) + 'T12:00:00')
    const dayOfMonth = date.getDate()
    const w = Math.min(3, Math.floor((dayOfMonth - 1) / 7))
    const dow = (date.getDay() + 6) % 7 // Mon=0 Sun=6

    const conv = Number(r.conversaciones) || 0
    const ag = Number(r.agendas) || 0
    const sh = Number(r.shows) || 0
    const ci = Number(r.cierres) || 0
    const ing = Number(r.ingreso) || 0

    byWeek.conversaciones[w] += conv; byWeekDay.conversaciones[w][dow] += conv
    byWeek.agendas[w] += ag;         byWeekDay.agendas[w][dow] += ag
    byWeek.shows[w] += sh;           byWeekDay.shows[w][dow] += sh
    byWeek.cierres[w] += ci;         byWeekDay.cierres[w][dow] += ci
    byWeek.ingresos[w] += ing;       byWeekDay.ingresos[w][dow] += ing
  })

  // Compute noShows per week and per day
  for (let w = 0; w < 4; w++) {
    byWeek.noShows[w] = Math.max(0, byWeek.agendas[w] - byWeek.shows[w])
    for (let d = 0; d < 7; d++) {
      byWeekDay.noShows[w][d] = Math.max(0, byWeekDay.agendas[w][d] - byWeekDay.shows[w][d])
    }
  }

  return {
    leads,
    conversaciones,
    analytics: { ...funnel, programas, byWeek, byWeekDay },
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MEMBER METRICS (for setter/closer dashboards)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function getMemberMetrics(
  allLeads: LeadRow[],
  memberName: string,
  field: 'setter' | 'closer'
): MemberMetrics {
  const memberLeads = allLeads.filter(l => l[field] === memberName)
  const funnel = calcFunnel(memberLeads)
  return { ...funnel, name: memberName, leads: memberLeads }
}
