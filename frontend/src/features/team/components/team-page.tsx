'use client'

import { useState, useEffect, useCallback } from 'react'
import { useMonthContext } from '@/shared/components/app-providers'
import { MonthSelector } from '@/shared/components/month-selector'
import { Modal } from '@/shared/components/modal'
import { useToast } from '@/shared/components/toast'
import { useSupabase } from '@/shared/hooks/use-supabase'
import { formatCash } from '@/shared/lib/supabase/queries'
import { DailyReportSection } from '@/features/team/components/daily-report-form'

type TeamMember = {
  id: string; name: string; role: string; comision_pct: number
  commission_type: string; commission_tiers: { min: number; max: number; pct: number }[]
  is_active: boolean
}

export function TeamPage() {
  const { month, options, setMonth } = useMonthContext()
  const { toast } = useToast()
  const { supabase, ready, userId } = useSupabase()
  const [members, setMembers] = useState<TeamMember[]>([])
  const [leads, setLeads] = useState<Record<string, unknown>[]>([])
  const [dailyByMember, setDailyByMember] = useState<Record<string, { conversaciones: number; agendas: number; shows: number; cierres: number; ingreso: number }>>({})
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [addRole, setAddRole] = useState<'setter' | 'closer'>('setter')
  const [comEstados, setComEstados] = useState<Record<string, string>>({})

  const fetchData = useCallback(async () => {
    if (!ready) return
    setLoading(true)
    const [membersRes, leadsRes, dailyRes] = await Promise.all([
      supabase.from('team_members').select('*').order('name'),
      supabase.from('leads').select('*').eq('month', month),
      supabase.from('daily_reports').select('*').eq('month', month),
    ])
    setMembers((membersRes.data as TeamMember[]) || [])
    setLeads(leadsRes.data || [])

    // Agrupar daily_reports por member_name
    const byMember: Record<string, { conversaciones: number; agendas: number; shows: number; cierres: number; ingreso: number }> = {}
    ;(dailyRes.data || []).forEach((r: Record<string, unknown>) => {
      const name = r.member_name as string
      if (!byMember[name]) byMember[name] = { conversaciones: 0, agendas: 0, shows: 0, cierres: 0, ingreso: 0 }
      byMember[name].conversaciones += Number(r.conversaciones) || 0
      byMember[name].agendas += Number(r.agendas) || 0
      byMember[name].shows += Number(r.shows) || 0
      byMember[name].cierres += Number(r.cierres) || 0
      byMember[name].ingreso += Number(r.ingreso) || 0
    })
    setDailyByMember(byMember)
    setLoading(false)
  }, [month, ready, supabase])

  useEffect(() => { fetchData() }, [fetchData])

  const handleAdd = async (name: string, role: string) => {
    if (!userId || !name.trim()) return
    await supabase.from('team_members').insert({ user_id: userId, name: name.trim(), role, comision_pct: 5 })
    toast(`${role} agregado ✓`)
    setShowAdd(false)
    fetchData()
  }

  const handleRemove = async (id: string) => {
    await supabase.from('team_members').delete().eq('id', id)
    toast('Eliminado ✓')
    fetchData()
  }

  const toggleEstado = (name: string) => {
    setComEstados(prev => ({ ...prev, [name]: prev[name] === 'Cobrado' ? 'Pendiente' : 'Cobrado' }))
  }

  const setters = members.filter(m => m.role === 'setter')
  const closers = members.filter(m => m.role === 'closer')

  const getMetrics = (name: string, role: 'setter' | 'closer') => {
    const dr = dailyByMember[name]
    const member = members.find(m => m.name === name)
    const comPct = member?.comision_pct || 5

    const conversaciones = dr?.conversaciones || 0
    const agendados = dr?.agendas || 0
    const shows = dr?.shows || 0
    const cierres = dr?.cierres || 0
    const cash = dr?.ingreso || 0
    const noShows = Math.max(0, agendados - shows)

    return {
      leads: conversaciones, cerrados: cierres, cash, agendados, noShows, shows,
      comision: cash * (comPct / 100), comPct,
      closeRate: shows > 0 ? (cierres / shows) * 100 : 0,
      showRate: agendados > 0 ? (shows / agendados) * 100 : 0,
      tasaAgend: conversaciones > 0 ? (agendados / conversaciones) * 100 : 0,
    }
  }

  // Total earnings
  const allMetrics = members.map(m => ({ ...getMetrics(m.name, m.role as 'setter' | 'closer'), name: m.name, role: m.role }))
  const totalCash = allMetrics.filter(m => m.role === 'closer').reduce((s, m) => s + m.cash, 0)
  const totalCom = allMetrics.reduce((s, m) => s + m.comision, 0)
  const netGain = totalCash - totalCom

  if (!ready || loading) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Dashboard de Equipo</h2>
        <div className="flex items-center gap-3">
          <MonthSelector month={month} options={options} onChange={setMonth} />
          <button onClick={() => { setAddRole('setter'); setShowAdd(true) }}
            className="rounded-lg border border-[var(--border2)] bg-transparent px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text2)] hover:border-[var(--accent)] hover:text-[var(--accent)]">+ Setter</button>
          <button onClick={() => { setAddRole('closer'); setShowAdd(true) }}
            className="rounded-lg border border-[var(--border2)] bg-transparent px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text2)] hover:border-[var(--accent)] hover:text-[var(--accent)]">+ Closer</button>
        </div>
      </div>

      {/* Earnings section */}
      <div className="mb-6 grid grid-cols-4 gap-4">
        <div className="glass-card p-5 border-l-2 border-l-[var(--green)]">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Cash Total Generado</div>
          <div className="font-mono-num mt-1 text-2xl font-bold text-[var(--green)]">{formatCash(totalCash)}</div>
        </div>
        <div className="glass-card p-5 border-l-2 border-l-[#A855F7]">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Total Comisiones</div>
          <div className="font-mono-num mt-1 text-2xl font-bold text-[#A855F7]">{formatCash(totalCom)}</div>
        </div>
        <div className="glass-card p-5 border-l-2 border-l-[var(--amber)]">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">% Sobre Cash</div>
          <div className="font-mono-num mt-1 text-2xl font-bold text-[var(--amber)]">{totalCash > 0 ? ((totalCom / totalCash) * 100).toFixed(1) : '0'}%</div>
        </div>
        <div className="glass-card p-5 border-l-2 border-l-[var(--green)]">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Ganancia Neta</div>
          <div className="font-mono-num mt-1 text-2xl font-bold text-[var(--green)]">{formatCash(netGain)}</div>
        </div>
      </div>

      {/* Team cards */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        {/* Setters */}
        <div>
          <h3 className="mb-4 text-[11px] font-medium uppercase tracking-widest text-[var(--text3)] border-b border-[var(--border)] pb-3">Setters</h3>
          {setters.length === 0 ? <p className="text-[13px] text-[var(--text3)]">Sin setters</p> : (
            <div className="space-y-3">
              {setters.map((s) => {
                const m = getMetrics(s.name, 'setter')
                const rend = m.agendados >= 4 ? 'Excelente' : m.agendados >= 2 ? 'En meta' : 'Regular'
                const rendColor = rend === 'Excelente' ? 'var(--green)' : rend === 'En meta' ? 'var(--amber)' : 'var(--red)'
                return (
                  <div key={s.id} className="glass-card p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase" style={{ backgroundColor: 'rgba(212,168,67,0.15)', color: '#d4a843' }}>Setter</span>
                        <span className="font-semibold text-[14px]">{s.name}</span>
                      </div>
                      <button onClick={() => handleRemove(s.id)} className="text-[var(--text3)] hover:text-[var(--red)] text-sm">×</button>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <div><div className="text-[9px] text-[var(--text3)] uppercase">Agendas mes</div><div className="font-mono-num text-lg font-semibold">{m.agendados}</div></div>
                      <div><div className="text-[9px] text-[var(--text3)] uppercase">Tasa agend.</div><div className="font-mono-num text-lg font-semibold">{m.tasaAgend?.toFixed(0) || 0}%</div></div>
                      <div><div className="text-[9px] text-[var(--text3)] uppercase">Rendimiento</div><div className="text-[13px] font-semibold" style={{ color: rendColor }}>{rend}</div></div>
                      <div><div className="text-[9px] text-[var(--text3)] uppercase">Comision</div><div className="font-mono-num text-lg font-semibold text-[var(--green)]">{formatCash(m.comision)}</div></div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        {/* Closers */}
        <div>
          <h3 className="mb-4 text-[11px] font-medium uppercase tracking-widest text-[var(--text3)] border-b border-[var(--border)] pb-3">Closers</h3>
          {closers.length === 0 ? <p className="text-[13px] text-[var(--text3)]">Sin closers</p> : (
            <div className="space-y-3">
              {closers.map((c) => {
                const m = getMetrics(c.name, 'closer')
                const rend = m.closeRate >= 50 ? 'Excelente' : m.closeRate >= 25 ? 'En meta' : 'Regular'
                const rendColor = rend === 'Excelente' ? 'var(--green)' : rend === 'En meta' ? 'var(--amber)' : 'var(--red)'
                return (
                  <div key={c.id} className="glass-card p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase" style={{ backgroundColor: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>Closer</span>
                        <span className="font-semibold text-[14px]">{c.name}</span>
                      </div>
                      <button onClick={() => handleRemove(c.id)} className="text-[var(--text3)] hover:text-[var(--red)] text-sm">×</button>
                    </div>
                    <div className="grid grid-cols-5 gap-2">
                      <div><div className="text-[9px] text-[var(--text3)] uppercase">Calls</div><div className="font-mono-num text-lg font-semibold">{m.leads}</div></div>
                      <div><div className="text-[9px] text-[var(--text3)] uppercase">Cierres</div><div className="font-mono-num text-lg font-semibold text-[var(--green)]">{m.cerrados}</div></div>
                      <div><div className="text-[9px] text-[var(--text3)] uppercase">Close %</div><div className="font-mono-num text-lg font-semibold">{m.closeRate.toFixed(0)}%</div></div>
                      <div><div className="text-[9px] text-[var(--text3)] uppercase">Rendimiento</div><div className="text-[13px] font-semibold" style={{ color: rendColor }}>{rend}</div></div>
                      <div><div className="text-[9px] text-[var(--text3)] uppercase">Comision</div><div className="font-mono-num text-lg font-semibold text-[var(--green)]">{formatCash(m.comision)}</div></div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Commission table */}
      <div className="glass-card p-6">
        <div className="mb-4 text-[11px] font-medium uppercase tracking-widest text-[var(--text3)]">Tabla de Comisiones</div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {['Nombre', 'Rol', 'Tipo', 'Generado', '% Aplicado', 'Comision', 'Estado'].map(h => (
                <th key={h} className="px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allMetrics.map((m) => {
              const estado = comEstados[m.name] || 'Pendiente'
              return (
                <tr key={m.name} className="border-b border-[var(--border)]">
                  <td className="px-2 py-2.5 text-[13px] font-medium">{m.name}</td>
                  <td className="px-2 py-2.5">
                    <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase" style={{
                      backgroundColor: m.role === 'setter' ? 'rgba(212,168,67,0.15)' : 'rgba(34,197,94,0.15)',
                      color: m.role === 'setter' ? '#d4a843' : '#22c55e'
                    }}>{m.role}</span>
                  </td>
                  <td className="px-2 py-2.5 text-[12px] text-[var(--text2)]">Fijo {m.comPct}%</td>
                  <td className="px-2 py-2.5 font-mono-num text-[13px]">{formatCash(m.cash)}</td>
                  <td className="px-2 py-2.5 font-mono-num text-[13px] text-[var(--text2)]">{m.comPct}%</td>
                  <td className="px-2 py-2.5 font-mono-num text-[13px] text-[var(--green)] font-medium">{formatCash(m.comision)}</td>
                  <td className="px-2 py-2.5">
                    <button onClick={() => toggleEstado(m.name)}
                      className={`rounded-full px-2.5 py-1 text-[10px] font-semibold cursor-pointer ${
                        estado === 'Cobrado' ? 'bg-[rgba(34,197,94,0.15)] text-[var(--green)]' : 'bg-[rgba(245,158,11,0.15)] text-[var(--amber)]'
                      }`}>
                      {estado}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Carga de reportes */}
      <div className="mt-8">
        <div className="text-[11px] font-medium uppercase tracking-widest text-[var(--text3)] mb-4 border-b border-[var(--border)] pb-3">Carga de Reportes</div>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h4 className="text-[12px] font-semibold mb-3 text-[var(--amber)]">Setter</h4>
            <DailyReportSection role="setter" />
          </div>
          <div>
            <h4 className="text-[12px] font-semibold mb-3 text-[var(--green)]">Closer</h4>
            <DailyReportSection role="closer" />
          </div>
        </div>
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={`Agregar ${addRole}`} maxWidth="400px">
        <AddMemberForm role={addRole} onAdd={handleAdd} onCancel={() => setShowAdd(false)} />
      </Modal>
    </div>
  )
}

function AddMemberForm({ role, onAdd, onCancel }: { role: string; onAdd: (name: string, role: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  return (
    <div>
      <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Nombre</label>
      <input type="text" value={name} onChange={e => setName(e.target.value)} autoFocus placeholder={`Nombre del ${role}`}
        className="mb-4 w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]" />
      <div className="flex justify-end gap-3">
        <button onClick={onCancel} className="rounded-lg border border-[var(--border2)] px-5 py-2.5 text-[11px] font-semibold uppercase text-[var(--text2)]">Cancelar</button>
        <button onClick={() => onAdd(name, role)} className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-[11px] font-semibold uppercase text-white">Agregar</button>
      </div>
    </div>
  )
}
