'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { useToast } from '@/shared/components/toast'
import { formatCash } from '@/shared/lib/format-utils'
import { apiFetch } from '@/lib/api'

type TeamMemberOption = { id: number; nombre: string }

type DailyReport = {
  date: string
  memberId: number | ''
  conversaciones: number
  agendas: number
  calendly_links: number
  calls_scheduled: number
  shows: number
  cierres: number
  calificados: number
  descalificados: number
  ingreso: number
  notes: string
  nombreLead: string
  estadoFinalLlamada: string
  perfilLead: string
  objecionMiedo: string
  doloresLlamada: string
  razonCompraFinal: string
  insightsMarketingLlamada: string
  sentimiento_trafico: string
  avatar_counts: Record<string, number>
  insights_marketing: string
  leads_nuevos: number
  seguimientos: number
  outbounds: number
  dia_bueno_malo: string
}

const SETTER_AVATAR_OPTIONS = [
  'Experto en info',
  'Dueño de agencia',
  'Dueño de negocio',
  'Habilidades de alto valor',
  'Creador de contenido',
  'Creador con infoproducto',
  'Otro',
] as const

function emptyAvatarCounts(): Record<string, number> {
  return Object.fromEntries(SETTER_AVATAR_OPTIONS.map((a) => [a, 0]))
}

function serializeAvatarCounts(counts: Record<string, number>): string | null {
  const obj: Record<string, number> = {}
  for (const [k, v] of Object.entries(counts)) {
    const n = parseInt(String(v), 10) || 0
    if (n > 0) obj[k] = n
  }
  return Object.keys(obj).length > 0 ? JSON.stringify(obj) : null
}

const CLOSER_ESTADOS_FINAL = [
  'Re-agendado',
  'Cerrado',
  'No cerrado',
  'Señado',
  'Descalificado',
] as const

const CLOSER_PERFILES_LEAD = [
  'Experto en infoproductos',
  'Dueño de agencias',
  'Setter / closer / editor / etc.',
  'Infoproductor (persona que ya tiene un producto digital validado)',
  'Creador de contenido (persona que no tiene un infoproducto y solo crea contenido)',
  'Otro',
] as const

type Props = {
  role: 'setter' | 'closer'
}

type CloserKind = 'ventas' | 'marketing'

type NumKey = 'conversaciones' | 'agendas' | 'calendly_links' | 'leads_nuevos' | 'seguimientos' | 'outbounds' | 'calls_scheduled' | 'shows' | 'cierres' | 'calificados' | 'descalificados' | 'ingreso'

function errMessage(data: unknown): string {
  if (data && typeof data === 'object' && 'detail' in data) {
    const d = (data as { detail: unknown }).detail
    if (typeof d === 'string') return d
    if (Array.isArray(d)) return d.map((x) => (typeof x === 'object' && x && 'msg' in x ? String((x as { msg: unknown }).msg) : JSON.stringify(x))).join(', ')
  }
  return 'Error en la solicitud'
}

export function DailyReportSection({ role }: Props) {
  const { ready, userId } = useAuthUser()
  const { toast } = useToast()
  const [members, setMembers] = useState<TeamMemberOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [setterSavedStamp, setSetterSavedStamp] = useState<string | null>(null)
  const [closerVentasSavedStamp, setCloserVentasSavedStamp] = useState<string | null>(null)
  /** Varios reportes marketing por día: contamos guardados exitosos para la pareja closer|fecha. */
  const [marketingSavedByStamp, setMarketingSavedByStamp] = useState<{ stamp: string; count: number }>({
    stamp: '',
    count: 0,
  })
  const marketingCountFetchGen = useRef(0)
  const [closerKind, setCloserKind] = useState<CloserKind>('ventas')

  const today = new Date().toISOString().split('T')[0]

  const [form, setForm] = useState<DailyReport>({
    date: today,
    memberId: '',
    conversaciones: 0,
    agendas: 0,
    calendly_links: 0,
    calls_scheduled: 0,
    shows: 0,
    cierres: 0,
    calificados: 0,
    descalificados: 0,
    ingreso: 0,
    notes: '',
    nombreLead: '',
    estadoFinalLlamada: '',
    perfilLead: '',
    objecionMiedo: '',
    doloresLlamada: '',
    razonCompraFinal: '',
    insightsMarketingLlamada: '',
    sentimiento_trafico: '',
    avatar_counts: emptyAvatarCounts(),
    insights_marketing: '',
    leads_nuevos: 0,
    seguimientos: 0,
    outbounds: 0,
    dia_bueno_malo: '',
  })

  const fetchMembers = useCallback(async () => {
    if (!ready || !userId) {
      setMembers([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await apiFetch('/team/members')
      if (!res.ok) {
        toast(errMessage(await res.json().catch(() => ({}))))
        setMembers([])
        return
      }
      const data = (await res.json()) as { setters: { id: number; nombre: string }[]; closers: { id: number; nombre: string }[] }
      const list = role === 'setter' ? data.setters ?? [] : data.closers ?? []
      setMembers(list.map((m) => ({ id: m.id, nombre: m.nombre })))
    } catch {
      toast('No se pudo cargar el equipo.')
      setMembers([])
    } finally {
      setLoading(false)
    }
  }, [ready, userId, role])

  useEffect(() => {
    void fetchMembers()
  }, [fetchMembers])

  const stamp = (mid: number | '', d: string) => `${mid}|${d}`

  useEffect(() => {
    if (role !== 'closer' || !ready || !userId || form.memberId === '') return
    marketingCountFetchGen.current += 1
    const gen = marketingCountFetchGen.current
    let cancelled = false
    const mid = form.memberId
    const d = form.date
    void (async () => {
      const res = await apiFetch(
        `/team/closer-marketing-report-count?fecha=${encodeURIComponent(d)}&member_id=${mid}`,
      )
      if (cancelled || !res.ok) return
      const data = (await res.json().catch(() => null)) as { count?: unknown } | null
      if (cancelled || !data || typeof data.count !== 'number') return
      if (marketingCountFetchGen.current !== gen) return
      setMarketingSavedByStamp({ stamp: stamp(mid, d), count: data.count })
    })()
    return () => {
      cancelled = true
    }
  }, [role, ready, userId, form.memberId, form.date])

  const setterSavedThisDate =
    role === 'setter' && setterSavedStamp === stamp(form.memberId, form.date) && form.memberId !== ''
  const setterSavedForDate = setterSavedThisDate && form.date === today

  const closerVentasSavedForSelection =
    form.memberId !== '' && closerVentasSavedStamp === stamp(form.memberId, form.date)

  const marketingCountForSelection =
    form.memberId !== '' && marketingSavedByStamp.stamp === stamp(form.memberId, form.date)
      ? marketingSavedByStamp.count
      : 0

  const resetCloserKindFields = () => {
    setForm((f) => ({
      ...f,
      calls_scheduled: 0,
      shows: 0,
      cierres: 0,
      calificados: 0,
      descalificados: 0,
      ingreso: 0,
      notes: '',
      nombreLead: '',
      estadoFinalLlamada: '',
      perfilLead: '',
      objecionMiedo: '',
      doloresLlamada: '',
      razonCompraFinal: '',
      insightsMarketingLlamada: '',
    }))
  }

  const handleCloserOpen = (kind: CloserKind) => {
    if (role !== 'closer') return
    if (showForm && closerKind === kind) {
      setShowForm(false)
      return
    }
    if (showForm && closerKind !== kind) {
      resetCloserKindFields()
    }
    setCloserKind(kind)
    setShowForm(true)
  }

  const numField = (
    key: NumKey,
    label: string,
    isCurrency = false,
    labelClass = 'text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]',
  ) => {
    const numVal = form[key] as number
    const displayValue = numVal === 0 ? '' : numVal
    return (
    <div>
      <label className={`mb-1.5 block leading-snug ${labelClass}`}>{label}</label>
      <input
        type="number"
        value={displayValue}
        onChange={(e) => {
          const raw = e.target.value
          if (raw === '') {
            setForm((f) => ({ ...f, [key]: 0 }))
            return
          }
          setForm((f) => ({
            ...f,
            [key]: isCurrency ? parseFloat(raw) || 0 : parseInt(raw, 10) || 0,
          }))
        }}
        placeholder="0"
        className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
      />
    </div>
    )
  }

  const textareaField = (
    key: 'sentimiento_trafico' | 'dia_bueno_malo' | 'insights_marketing',
    label: string,
    placeholder: string,
    rows: number,
  ) => (
    <div>
      <label className="mb-1.5 block text-[12px] font-medium leading-snug text-[var(--text)]">{label}</label>
      <textarea
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        rows={rows}
        placeholder={placeholder}
        className="w-full resize-y rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
      />
    </div>
  )

  const handleSave = async () => {
    if (!userId) {
      toast('Iniciá sesión')
      return
    }
    if (form.memberId === '') {
      toast('Seleccioná un miembro')
      return
    }
    setSaving(true)
    try {
      if (role === 'setter') {
        const res = await apiFetch('/team/setter-reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            member_id: form.memberId,
            fecha: form.date,
            conversaciones: form.conversaciones,
            agendas: form.agendas,
            links_enviados: form.calendly_links,
            notas: null,
            sentimiento_trafico: form.sentimiento_trafico.trim() || null,
            avatar_tipo_agendas: serializeAvatarCounts(form.avatar_counts),
            insights_marketing: form.insights_marketing.trim() || null,
            leads_nuevos: form.leads_nuevos,
            seguimientos: form.seguimientos,
            outbounds: form.outbounds,
            dia_bueno_malo: form.dia_bueno_malo.trim() || null,
          }),
        })
        if (!res.ok) {
          toast(errMessage(await res.json().catch(() => ({}))))
          return
        }
      } else {
        if (closerKind === 'marketing') {
          if (!form.nombreLead.trim()) {
            toast('Indicá el nombre del lead.')
            setSaving(false)
            return
          }
          if (!form.estadoFinalLlamada || !form.perfilLead) {
            toast('Seleccioná el estado final de la llamada y el perfil del lead.')
            setSaving(false)
            return
          }
        }
        const res = await apiFetch('/team/closer-reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            closerKind === 'marketing'
              ? {
                  member_id: form.memberId,
                  fecha: form.date,
                  reporte_tipo: 'marketing',
                  llamadas_agendadas: 0,
                  shows: 0,
                  cierres: 0,
                  calificados: 0,
                  descalificados: 0,
                  ingreso: 0,
                  notas: null,
                  nombre_lead: form.nombreLead.trim(),
                  estado_final_llamada: form.estadoFinalLlamada,
                  perfil_lead: form.perfilLead,
                  objecion_miedo: form.objecionMiedo.trim() || null,
                  dolores_llamada: form.doloresLlamada.trim() || null,
                  razon_compra_final: form.razonCompraFinal.trim() || null,
                  insights_marketing_llamada: form.insightsMarketingLlamada.trim() || null,
                }
              : {
                  member_id: form.memberId,
                  fecha: form.date,
                  reporte_tipo: 'ventas',
                  llamadas_agendadas: form.calls_scheduled,
                  shows: form.shows,
                  cierres: form.cierres,
                  calificados: form.calificados,
                  descalificados: form.descalificados,
                  ingreso: form.ingreso,
                  notas: form.notes.trim() || null,
                },
          ),
        })
        if (!res.ok) {
          toast(errMessage(await res.json().catch(() => ({}))))
          return
        }
      }
      const s = stamp(form.memberId, form.date)
      if (role === 'setter') {
        toast('Reporte guardado')
        setSetterSavedStamp(s)
        setShowForm(false)
      } else if (closerKind === 'marketing') {
        toast('Llamada guardada — podés cargar otra')
        setMarketingSavedByStamp((prev) =>
          prev.stamp === s ? { stamp: s, count: prev.count + 1 } : { stamp: s, count: 1 },
        )
        setForm((f) => ({
          ...f,
          nombreLead: '',
          estadoFinalLlamada: '',
          perfilLead: '',
          objecionMiedo: '',
          doloresLlamada: '',
          razonCompraFinal: '',
          insightsMarketingLlamada: '',
        }))
      } else {
        toast('Reporte guardado')
        setCloserVentasSavedStamp(s)
        setShowForm(false)
      }
      void fetchMembers()
      window.dispatchEvent(new Event('atvmkt-team-reports-changed'))
    } catch {
      toast('No se pudo guardar el reporte.')
    } finally {
      setSaving(false)
    }
  }

  if (!ready || loading) {
    return (
      <div className="flex min-h-[100px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg3)] px-4 py-8 text-[13px] text-[var(--text3)]">
        <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]" aria-hidden />
        <span className="mt-3">Cargando equipo…</span>
      </div>
    )
  }

  if (!userId) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg3)] px-4 py-8 text-center text-[13px] text-[var(--text3)]">
        Iniciá sesión para cargar reportes.
      </div>
    )
  }

  const closerBtnLabel = (kind: CloserKind) => {
    const short = kind === 'ventas' ? 'ventas' : 'marketing'
    const hoy = form.date === today
    if (showForm && closerKind === kind) return 'Cerrar'
    if (kind === 'ventas' && closerVentasSavedForSelection) {
      return hoy ? `Editar reporte de hoy ${short}` : `Editar reporte ${short}`
    }
    if (kind === 'marketing' && marketingCountForSelection > 0) {
      return '+ Otra llamada (marketing)'
    }
    return kind === 'marketing' ? '+ Reporte marketing por llamada' : `+ Cargar reporte diario ${short}`
  }

  return (
    <div className="space-y-4">
      {role === 'setter' ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowForm(!showForm)}
            className="w-full rounded-xl bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white shadow-[0_4px_18px_-6px_rgba(230,57,70,0.55)] transition-all hover:brightness-110 hover:shadow-[0_6px_22px_-6px_rgba(230,57,70,0.45)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            {showForm
              ? 'Cerrar'
              : setterSavedThisDate
                ? setterSavedForDate
                  ? 'Editar reporte de hoy'
                  : 'Editar reporte'
                : '+ Cargar reporte diario'}
          </button>
          {setterSavedForDate && (
            <span className="block text-[11px] font-medium text-[var(--green)]">✓ Reporte de hoy cargado</span>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => handleCloserOpen('ventas')}
              className="w-full rounded-xl bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white shadow-[0_4px_18px_-6px_rgba(230,57,70,0.55)] transition-all hover:brightness-110 hover:shadow-[0_6px_22px_-6px_rgba(230,57,70,0.45)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              {closerBtnLabel('ventas')}
            </button>
            {closerVentasSavedForSelection && form.date === today && form.memberId !== '' && (
              <span className="block text-[11px] font-medium text-[var(--green)]">✓ Ventas hoy</span>
            )}
          </div>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => handleCloserOpen('marketing')}
              className="w-full rounded-xl bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white shadow-[0_4px_18px_-6px_rgba(230,57,70,0.55)] transition-all hover:brightness-110 hover:shadow-[0_6px_22px_-6px_rgba(230,57,70,0.45)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              {closerBtnLabel('marketing')}
            </button>
            {marketingCountForSelection > 0 && form.date === today && form.memberId !== '' && (
              <span className="block text-[11px] font-medium text-[var(--green)]">
                ✓ {marketingCountForSelection} llamada{marketingCountForSelection === 1 ? '' : 's'} marketing hoy
              </span>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <div className="glass-card glass-card--performant p-5">
          <div className="mb-4 text-[13px] font-semibold">
            {role === 'setter'
              ? 'Reporte Diario — Setter'
              : closerKind === 'ventas'
                ? 'Reporte Diario — Closer (Ventas)'
                : 'Reporte por llamada — Closer (Marketing)'}
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-[11px] font-medium leading-snug text-[var(--text2)]">Fecha</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-medium leading-snug text-[var(--text2)]">
                {role === 'setter' ? 'Setter (selección)' : 'Closer (selección)'}
              </label>
              <select
                value={form.memberId === '' ? '' : String(form.memberId)}
                onChange={(e) => {
                  const v = e.target.value
                  setForm((f) => ({ ...f, memberId: v ? parseInt(v, 10) : '' }))
                }}
                className="w-full cursor-pointer rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
              >
                <option value="">Seleccionar…</option>
                {members.length === 0 ? (
                  <option value="" disabled>
                    Sin miembros ({role})
                  </option>
                ) : (
                  members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          {role === 'setter' ? (
            <>
              <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                {numField('conversaciones', 'Conversaciones', false, 'text-[11px] font-medium leading-snug text-[var(--text2)]')}
                {numField('agendas', 'Agendas', false, 'text-[11px] font-medium leading-snug text-[var(--text2)]')}
                {numField('calendly_links', 'Calendlys enviados', false, 'text-[11px] font-medium leading-snug text-[var(--text2)]')}
              </div>
              <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                {numField('leads_nuevos', 'Leads nuevos', false, 'text-[11px] font-medium leading-snug text-[var(--text2)]')}
                {numField('seguimientos', 'Seguimientos', false, 'text-[11px] font-medium leading-snug text-[var(--text2)]')}
                {numField('outbounds', 'Outbounds', false, 'text-[11px] font-medium leading-snug text-[var(--text2)]')}
              </div>
              <div className="mb-4">
                <label className="mb-2 block text-[12px] font-medium leading-snug text-[var(--text)]">
                  Avatar / Tipo de agendas generadas
                </label>
                <div className="space-y-2 rounded-lg border border-[var(--border2)] bg-[var(--bg3)] p-3">
                  {SETTER_AVATAR_OPTIONS.map((avatar) => (
                    <div key={avatar} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 flex-1 text-[12px] leading-snug text-[var(--text2)]">{avatar}</span>
                      <input
                        type="number"
                        min={0}
                        value={(form.avatar_counts[avatar] ?? 0) === 0 ? '' : form.avatar_counts[avatar]}
                        onChange={(e) => {
                          const raw = e.target.value
                          if (raw === '') {
                            setForm((f) => ({
                              ...f,
                              avatar_counts: { ...f.avatar_counts, [avatar]: 0 },
                            }))
                            return
                          }
                          const n = parseInt(raw, 10) || 0
                          setForm((f) => ({
                            ...f,
                            avatar_counts: { ...f.avatar_counts, [avatar]: n },
                          }))
                        }}
                        placeholder="0"
                        className="w-20 shrink-0 rounded-lg border border-[var(--border2)] bg-[var(--bg2)] px-2 py-1.5 text-right text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div className="mb-4 space-y-4">
                {textareaField('sentimiento_trafico', 'Tipo de tráfico', 'Ej.: más lento de lo habitual, picos al mediodía…', 2)}
                {textareaField('dia_bueno_malo', '¿Fue un día bueno o malo?', 'Ej.: Bueno — buen volumen y calidad de leads…', 2)}
                {textareaField(
                  'insights_marketing',
                  'Feedback a MKT',
                  'Qué viste en conversaciones que sirva para creativos, copy o segmentación…',
                  4,
                )}
              </div>
            </>
          ) : closerKind === 'ventas' ? (
            <>
              <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                {numField('calls_scheduled', 'Llamadas agendadas', false, 'text-[11px] font-medium leading-snug text-[var(--text2)]')}
                {numField('shows', 'Shows (presentadas)', false, 'text-[11px] font-medium leading-snug text-[var(--text2)]')}
                {numField('cierres', 'Cierres', false, 'text-[11px] font-medium leading-snug text-[var(--text2)]')}
                {numField('calificados', 'Calificados', false, 'text-[11px] font-medium leading-snug text-[var(--text2)]')}
                {numField('descalificados', 'Descalificados', false, 'text-[11px] font-medium leading-snug text-[var(--text2)]')}
                {numField('ingreso', 'Ingreso ($)', true, 'text-[11px] font-medium leading-snug text-[var(--text2)]')}
              </div>
              <div className="mb-4">
                <label className="mb-1.5 block text-[11px] font-medium leading-snug text-[var(--text2)]">
                  Notas (observaciones del día)
                </label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  placeholder="Observaciones del día..."
                  className="w-full resize-y rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
                />
              </div>
            </>
          ) : (
            <div className="mb-4 space-y-4">
              <p className="text-[11px] leading-snug text-[var(--text3)]">
                Un guardado = una llamada. Podés cargar todas las del mismo día con la misma fecha y closer.
              </p>
              <div>
                <label className="mb-1.5 block text-[11px] font-medium leading-snug text-[var(--text2)]">
                  Nombre del lead
                </label>
                <input
                  type="text"
                  value={form.nombreLead}
                  onChange={(e) => setForm((f) => ({ ...f, nombreLead: e.target.value }))}
                  placeholder="Nombre o cómo lo identificás en el CRM…"
                  autoComplete="off"
                  className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-[11px] font-medium leading-snug text-[var(--text2)]">
                    Estado final de la llamada
                  </label>
                  <select
                    value={form.estadoFinalLlamada}
                    onChange={(e) => setForm((f) => ({ ...f, estadoFinalLlamada: e.target.value }))}
                    className="w-full cursor-pointer rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
                  >
                    <option value="">Seleccionar…</option>
                    {CLOSER_ESTADOS_FINAL.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-[11px] font-medium leading-snug text-[var(--text2)]">
                    ¿Qué perfil tenía el lead?
                  </label>
                  <select
                    value={form.perfilLead}
                    onChange={(e) => setForm((f) => ({ ...f, perfilLead: e.target.value }))}
                    className="w-full cursor-pointer rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
                  >
                    <option value="">Seleccionar…</option>
                    {CLOSER_PERFILES_LEAD.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-medium leading-snug text-[var(--text2)]">
                  ¿Cuál fue su mayor objeción o miedo, cómo lo expresó?
                </label>
                <textarea
                  value={form.objecionMiedo}
                  onChange={(e) => setForm((f) => ({ ...f, objecionMiedo: e.target.value }))}
                  rows={3}
                  placeholder="Ej.: Me lo tengo que pensar ya que estoy viendo otras mentorías para ingresar…"
                  className="w-full resize-y rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-medium leading-snug text-[var(--text2)]">
                  ¿Cuáles fueron sus principales dolores dentro de la llamada?
                </label>
                <textarea
                  value={form.doloresLlamada}
                  onChange={(e) => setForm((f) => ({ ...f, doloresLlamada: e.target.value }))}
                  rows={3}
                  placeholder="Ej.: No sé cómo escalar sin ADS y potenciar mi orgánico…"
                  className="w-full resize-y rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-medium leading-snug text-[var(--text2)]">
                  ¿Cuál fue su razón de compra final?
                </label>
                <textarea
                  value={form.razonCompraFinal}
                  onChange={(e) => setForm((f) => ({ ...f, razonCompraFinal: e.target.value }))}
                  rows={2}
                  placeholder="Ej.: Los sistemas y el equipo…"
                  className="w-full resize-y rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-medium leading-snug text-[var(--text2)]">
                  Insights clave que podés aportar a marketing desde la llamada
                </label>
                <textarea
                  value={form.insightsMarketingLlamada}
                  onChange={(e) => setForm((f) => ({ ...f, insightsMarketingLlamada: e.target.value }))}
                  rows={4}
                  placeholder="Ej.: Más contenido sobre sistemas y SOPs internos de ATV; más casos de éxito en el día a día…"
                  className="w-full resize-y rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
                />
              </div>
            </div>
          )}

          {role === 'setter' && form.conversaciones > 0 && (
            <div className="mb-4 flex gap-6 rounded-lg border border-[var(--border)] bg-[var(--bg3)] p-3">
              <div className="text-[11px]">
                <span className="text-[var(--text3)]">Tasa agend.:</span>{' '}
                <span className="font-semibold text-[var(--accent)]">
                  {form.conversaciones > 0 ? ((form.agendas / form.conversaciones) * 100).toFixed(1) : 0}%
                </span>
              </div>
            </div>
          )}
          {role === 'closer' && closerKind === 'ventas' && form.shows > 0 && (
            <div className="mb-4 flex gap-6 rounded-lg border border-[var(--border)] bg-[var(--bg3)] p-3">
              <div className="text-[11px]">
                <span className="text-[var(--text3)]">Close Rate:</span>{' '}
                <span className="font-semibold text-[var(--accent)]">
                  {form.shows > 0 ? ((form.cierres / form.shows) * 100).toFixed(1) : 0}%
                </span>
              </div>
              <div className="text-[11px]">
                <span className="text-[var(--text3)]">Ticket prom:</span>{' '}
                <span className="font-semibold text-[var(--green)]">{form.cierres > 0 ? formatCash(form.ingreso / form.cierres) : '$0'}</span>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-xl bg-[var(--accent)] px-6 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white shadow-[0_4px_18px_-6px_rgba(230,57,70,0.55)] transition-all hover:brightness-110 disabled:opacity-50 disabled:shadow-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            {saving ? 'Guardando...' : 'Guardar reporte'}
          </button>
        </div>
      )}
    </div>
  )
}
