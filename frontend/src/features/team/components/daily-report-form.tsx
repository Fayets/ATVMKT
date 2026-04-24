'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSupabase } from '@/shared/hooks/use-supabase'
import { useToast } from '@/shared/components/toast'
import { formatCash } from '@/shared/lib/supabase/queries'

type DailyReport = {
  id?: string
  date: string
  member_name: string
  role: string
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
  month: string
}

type Props = {
  role: 'setter' | 'closer'
}

export function DailyReportSection({ role }: Props) {
  const { supabase, ready, userId } = useSupabase()
  const { toast } = useToast()
  const [members, setMembers] = useState<{ name: string }[]>([])
  const [reports, setReports] = useState<DailyReport[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const today = new Date().toISOString().split('T')[0]
  const todayMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`

  const [form, setForm] = useState<DailyReport>({
    date: today,
    member_name: '',
    role,
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
    month: todayMonth,
  })

  const fetchData = useCallback(async () => {
    if (!ready) return
    setLoading(true)
    const [membersRes, reportsRes] = await Promise.all([
      supabase.from('team_members').select('name').eq('role', role).eq('is_active', true),
      supabase.from('daily_reports').select('*').eq('role', role).order('date', { ascending: false }).limit(30),
    ])
    setMembers(membersRes.data || [])
    setReports((reportsRes.data || []) as DailyReport[])
    if (membersRes.data?.[0]) {
      setForm(f => ({ ...f, member_name: f.member_name || membersRes.data![0].name }))
    }
    setLoading(false)
  }, [ready, role, supabase])

  useEffect(() => { fetchData() }, [fetchData])

  // Auto-calcular month cuando cambia date
  useEffect(() => {
    const [y, m] = form.date.split('-')
    setForm(f => ({ ...f, month: `${y}-${m}` }))
  }, [form.date])

  const todayReport = reports.find(r => r.date === today && r.member_name === form.member_name)

  const handleSave = async () => {
    if (!userId || !form.member_name) { toast('Seleccioná un miembro'); return }
    setSaving(true)

    const payload = {
      user_id: userId,
      date: form.date,
      role,
      member_name: form.member_name,
      conversaciones: form.conversaciones,
      agendas: form.agendas,
      calendly_links: form.calendly_links,
      calls_scheduled: form.calls_scheduled,
      shows: form.shows,
      cierres: form.cierres,
      calificados: form.calificados,
      descalificados: form.descalificados,
      ingreso: form.ingreso,
      notes: form.notes,
      month: form.month,
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase.from('daily_reports').upsert(payload, { onConflict: 'user_id,member_name,date' })

    if (error) {
      toast(`Error: ${error.message}`)
    } else {
      toast('Reporte guardado ✓')
      setShowForm(false)
      fetchData()
    }
    setSaving(false)
  }

  if (loading) return null

  const numField = (key: keyof DailyReport, label: string, isCurrency = false) => (
    <div>
      <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">{label}</label>
      <input
        type="number"
        value={form[key] as number || ''}
        onChange={e => setForm(f => ({ ...f, [key]: isCurrency ? parseFloat(e.target.value) || 0 : parseInt(e.target.value) || 0 }))}
        placeholder="0"
        className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
      />
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Botón para abrir formulario */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase text-white hover:brightness-110 transition-all"
        >
          {showForm ? 'Cerrar' : todayReport ? 'Editar reporte de hoy' : '+ Cargar reporte diario'}
        </button>
        {todayReport && (
          <span className="text-[11px] text-[var(--green)] font-medium">✓ Reporte de hoy cargado</span>
        )}
      </div>

      {/* Formulario */}
      {showForm && (
        <div className="glass-card p-5">
          <div className="text-[13px] font-semibold mb-4">
            Reporte Diario — {role === 'setter' ? 'Setter' : 'Closer'}
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Fecha</label>
              <input
                type="date"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">{role === 'setter' ? 'Setter' : 'Closer'}</label>
              <select
                value={form.member_name}
                onChange={e => setForm(f => ({ ...f, member_name: e.target.value }))}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none cursor-pointer focus:border-[var(--text3)]"
              >
                {members.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-4">
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
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
              placeholder="Observaciones del día..."
              className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)] resize-y"
            />
          </div>

          {/* Preview de métricas calculadas */}
          {role === 'setter' && form.conversaciones > 0 && (
            <div className="mb-4 rounded-lg bg-[var(--bg3)] border border-[var(--border)] p-3 flex gap-6">
              <div className="text-[11px]"><span className="text-[var(--text3)]">Tasa agend.:</span> <span className="font-semibold text-[var(--accent)]">{form.conversaciones > 0 ? ((form.agendas / form.conversaciones) * 100).toFixed(1) : 0}%</span></div>
            </div>
          )}
          {role === 'closer' && form.shows > 0 && (
            <div className="mb-4 rounded-lg bg-[var(--bg3)] border border-[var(--border)] p-3 flex gap-6">
              <div className="text-[11px]"><span className="text-[var(--text3)]">Close Rate:</span> <span className="font-semibold text-[var(--accent)]">{form.shows > 0 ? ((form.cierres / form.shows) * 100).toFixed(1) : 0}%</span></div>
              <div className="text-[11px]"><span className="text-[var(--text3)]">Ticket prom:</span> <span className="font-semibold text-[var(--green)]">{form.cierres > 0 ? formatCash(form.ingreso / form.cierres) : '$0'}</span></div>
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-[var(--accent)] px-6 py-2.5 text-[11px] font-semibold uppercase text-white hover:brightness-110 transition-all disabled:opacity-50"
          >
            {saving ? 'Guardando...' : 'Guardar reporte'}
          </button>
        </div>
      )}

      {/* Historial de reportes */}
      {reports.length > 0 && (
        <div className="glass-card overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--border)]">
            <span className="text-[11px] font-medium uppercase tracking-widest text-[var(--text3)]">Historial de reportes</span>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Fecha</th>
                <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">{role === 'setter' ? 'Setter' : 'Closer'}</th>
                {role === 'setter' ? (
                  <>
                    <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Conv.</th>
                    <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Agendas</th>
                    <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Tasa</th>
                  </>
                ) : (
                  <>
                    <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Shows</th>
                    <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Cierres</th>
                    <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Close %</th>
                    <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Ingreso</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {reports.map(r => (
                <tr key={r.id} className="border-b border-[var(--border)]">
                  <td className="px-5 py-2.5 text-[13px]">{r.date}</td>
                  <td className="px-5 py-2.5 text-[13px] font-medium">{r.member_name}</td>
                  {role === 'setter' ? (
                    <>
                      <td className="px-5 py-2.5 font-mono-num text-[13px]">{r.conversaciones}</td>
                      <td className="px-5 py-2.5 font-mono-num text-[13px]">{r.agendas}</td>
                      <td className="px-5 py-2.5 font-mono-num text-[13px] text-[var(--accent)]">{r.conversaciones > 0 ? ((r.agendas / r.conversaciones) * 100).toFixed(1) + '%' : '—'}</td>
                    </>
                  ) : (
                    <>
                      <td className="px-5 py-2.5 font-mono-num text-[13px]">{r.shows}</td>
                      <td className="px-5 py-2.5 font-mono-num text-[13px]">{r.cierres}</td>
                      <td className="px-5 py-2.5 font-mono-num text-[13px] text-[var(--accent)]">{r.shows > 0 ? ((r.cierres / r.shows) * 100).toFixed(1) + '%' : '—'}</td>
                      <td className="px-5 py-2.5 font-mono-num text-[13px] text-[var(--green)]">{formatCash(r.ingreso)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
