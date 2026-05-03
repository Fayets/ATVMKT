'use client'

import { useState, useEffect, useCallback } from 'react'
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
}

type Props = {
  role: 'setter' | 'closer'
}

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
  const [lastSaved, setLastSaved] = useState<string | null>(null)

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

  const todaySaved = lastSaved === `${form.memberId}-${today}` && form.date === today

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
            notas: form.notes.trim() || null,
          }),
        })
        if (!res.ok) {
          toast(errMessage(await res.json().catch(() => ({}))))
          return
        }
      } else {
        const res = await apiFetch('/team/closer-reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            member_id: form.memberId,
            fecha: form.date,
            llamadas_agendadas: form.calls_scheduled,
            shows: form.shows,
            cierres: form.cierres,
            calificados: form.calificados,
            descalificados: form.descalificados,
            ingreso: form.ingreso,
            notas: form.notes.trim() || null,
          }),
        })
        if (!res.ok) {
          toast(errMessage(await res.json().catch(() => ({}))))
          return
        }
      }
      toast('Reporte guardado')
      setLastSaved(`${form.memberId}-${form.date}`)
      setShowForm(false)
      void fetchMembers()
    } catch {
      toast('No se pudo guardar el reporte.')
    } finally {
      setSaving(false)
    }
  }

  if (!ready || loading) return <div className="text-[13px] text-[var(--text3)]">Cargando…</div>

  if (!userId) {
    return <div className="text-[13px] text-[var(--text3)]">Iniciá sesión para cargar reportes.</div>
  }

  const numField = (key: keyof DailyReport, label: string, isCurrency = false) => (
    <div>
      <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">{label}</label>
      <input
        type="number"
        value={form[key] === '' ? '' : (form[key] as number) || ''}
        onChange={(e) =>
          setForm((f) => ({
            ...f,
            [key]: isCurrency ? parseFloat(e.target.value) || 0 : parseInt(e.target.value, 10) || 0,
          }))
        }
        placeholder="0"
        className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
      />
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase text-white transition-all hover:brightness-110"
        >
          {showForm ? 'Cerrar' : todaySaved ? 'Editar reporte de hoy' : '+ Cargar reporte diario'}
        </button>
        {todaySaved && <span className="text-[11px] font-medium text-[var(--green)]">✓ Reporte de hoy cargado</span>}
      </div>

      {showForm && (
        <div className="glass-card p-5">
          <div className="mb-4 text-[13px] font-semibold">Reporte Diario — {role === 'setter' ? 'Setter' : 'Closer'}</div>

          <div className="mb-4 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Fecha</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
                {role === 'setter' ? 'Setter' : 'Closer'}
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

          <div className="mb-4 grid grid-cols-3 gap-3">
            {role === 'setter' ? (
              <>
                {numField('conversaciones', 'Conversaciones')}
                {numField('agendas', 'Agendas')}
                {numField('calendly_links', 'Links enviados')}
              </>
            ) : (
              <>
                {numField('calls_scheduled', 'Llamadas agendadas')}
                {numField('shows', 'Shows (presentadas)')}
                {numField('cierres', 'Cierres')}
                {numField('calificados', 'Calificados')}
                {numField('descalificados', 'Descalificados')}
                {numField('ingreso', 'Ingreso ($)', true)}
              </>
            )}
          </div>

          <div className="mb-4">
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Notas</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              placeholder="Observaciones del día..."
              className="w-full resize-y rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
            />
          </div>

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
          {role === 'closer' && form.shows > 0 && (
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
            className="rounded-lg bg-[var(--accent)] px-6 py-2.5 text-[11px] font-semibold uppercase text-white transition-all hover:brightness-110 disabled:opacity-50"
          >
            {saving ? 'Guardando...' : 'Guardar reporte'}
          </button>
        </div>
      )}
    </div>
  )
}
