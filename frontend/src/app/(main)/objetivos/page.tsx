'use client'

import { useState, useEffect, useCallback } from 'react'
import { useMonthContext } from '@/shared/components/app-providers'
import { MonthSelector } from '@/shared/components/month-selector'
import { useToast } from '@/shared/components/toast'
import { useSupabase } from '@/shared/hooks/use-supabase'
import { getMonthRange, formatCash, formatK } from '@/shared/lib/supabase/queries'
import { calcFunnel, type LeadRow } from '@/features/leads/services/leads-analytics'

export default function ObjetivosPage() {
  const { month, options, setMonth } = useMonthContext()
  const { toast } = useToast()
  const { supabase, ready, userId } = useSupabase()
  const [objectives, setObjectives] = useState({ cash_target: 100000, chats_target: 1500, views_target: 800000, followers_target: 2000, pieces_target: 16, cierres_target: 15, ventas_cash_target: 50000, scenario: '' })
  const [current, setCurrent] = useState({ cash: 0, chats: 0, piezas: 0, views: 0, cierres: 0, ventasCash: 0 })
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    if (!ready) return
    setLoading(true)
    const { start, end } = getMonthRange(month)

    const [objRes, contentRes, bioRes, acctRes, leadsRes] = await Promise.all([
      supabase.from('objectives').select('*').eq('month', month).maybeSingle(),
      supabase.from('content_items').select('cash, chats').gte('published_at', start).lte('published_at', end),
      supabase.from('bio_entries').select('cash, chats').eq('month', month),
      supabase.from('account_metrics').select('account_views').eq('month', month).maybeSingle(),
      supabase.from('leads').select('*').eq('month', month),
    ])

    if (objRes.data) {
      setObjectives({
        cash_target: Number(objRes.data.cash_target) || 100000,
        chats_target: Number(objRes.data.chats_target) || 1500,
        views_target: Number(objRes.data.views_target) || 800000,
        followers_target: Number(objRes.data.followers_target) || 2000,
        pieces_target: Number(objRes.data.pieces_target) || 16,
        cierres_target: Number(objRes.data.cierres_target) || 15,
        ventas_cash_target: Number(objRes.data.ventas_cash_target) || 50000,
        scenario: objRes.data.scenario || '',
      })
    }

    const content = contentRes.data || []
    const bio = bioRes.data || []
    const cash = content.reduce((s: number, i: { cash: number }) => s + (Number(i.cash) || 0), 0) + bio.reduce((s: number, i: { cash: number }) => s + (Number(i.cash) || 0), 0)
    const chats = content.reduce((s: number, i: { chats: number }) => s + (Number(i.chats) || 0), 0) + bio.reduce((s: number, i: { chats: number }) => s + (Number(i.chats) || 0), 0)

    // Sales from leads
    const leadsFunnel = calcFunnel((leadsRes.data || []) as LeadRow[])

    setCurrent({ cash, chats, piezas: content.length, views: Number(acctRes.data?.account_views) || 0, cierres: leadsFunnel.cierres, ventasCash: leadsFunnel.ingresos })
    setLoading(false)
  }, [month, ready, supabase])

  useEffect(() => { fetchData() }, [fetchData])

  const saveObjective = async (field: string, value: number) => {
    if (!userId) return
    const updated = { ...objectives, [field]: value }
    setObjectives(updated)
    await supabase.from('objectives').upsert({ user_id: userId, month, ...updated, updated_at: new Date().toISOString() }, { onConflict: 'user_id,month' })
    toast('Objetivo guardado ✓')
  }

  if (loading) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>

  const metrics = [
    { label: 'Cash Contenido', current: current.cash, target: objectives.cash_target, field: 'cash_target', fmt: formatCash },
    { label: 'Cash Ventas', current: current.ventasCash, target: objectives.ventas_cash_target, field: 'ventas_cash_target', fmt: formatCash },
    { label: 'Cierres', current: current.cierres, target: objectives.cierres_target, field: 'cierres_target', fmt: (n: number) => String(n) },
    { label: 'Chats', current: current.chats, target: objectives.chats_target, field: 'chats_target', fmt: (n: number) => n.toLocaleString() },
    { label: 'Views', current: current.views, target: objectives.views_target, field: 'views_target', fmt: formatK },
    { label: 'Piezas', current: current.piezas, target: objectives.pieces_target, field: 'pieces_target', fmt: (n: number) => String(n) },
  ]

  // Days
  const [y, m] = month.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const now = new Date()
  const isCurrent = now.getFullYear() === y && now.getMonth() + 1 === m
  const dayNow = isCurrent ? now.getDate() : daysInMonth
  const daysLeft = daysInMonth - dayNow
  const cashRemaining = Math.max(0, objectives.cash_target - current.cash)
  const cashPerDay = daysLeft > 0 ? cashRemaining / daysLeft : 0

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Objetivos del Mes</h2>
        <MonthSelector month={month} options={options} onChange={setMonth} />
      </div>

      {/* Pace card */}
      <div className="glass-card mb-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] text-[var(--text3)] uppercase tracking-wider">Ritmo necesario</div>
            <div className="font-mono-num mt-1 text-2xl font-bold text-[var(--amber)]">{formatCash(cashPerDay)}/dia</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-[var(--text3)]">Faltan {formatCash(cashRemaining)} en {daysLeft} dias</div>
            <div className="font-mono-num mt-1 text-[14px]">
              Dia {dayNow}/{daysInMonth}
            </div>
          </div>
        </div>
      </div>

      {/* Objective cards */}
      <div className="grid grid-cols-3 gap-4">
        {metrics.map((met) => {
          const pct = met.target > 0 ? Math.min((met.current / met.target) * 100, 100) : 0
          const onTrack = pct >= (dayNow / daysInMonth) * 100 * 0.9
          const color = onTrack ? 'var(--green)' : pct >= 50 ? 'var(--amber)' : 'var(--red)'
          return (
            <div key={met.field} className="glass-card p-5">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text3)]">{met.label}</span>
                <span className="font-mono-num text-[11px]" style={{ color }}>{pct.toFixed(0)}%</span>
              </div>
              <div className="mb-2 flex items-baseline justify-between">
                <span className="font-mono-num text-2xl font-bold" style={{ color }}>{met.fmt(met.current)}</span>
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-[var(--text3)]">/ meta:</span>
                  <input
                    type="number"
                    value={met.target}
                    onChange={(e) => saveObjective(met.field, Number(e.target.value))}
                    className="w-24 rounded border border-[var(--border2)] bg-[var(--bg3)] px-2 py-1 text-right font-mono-num text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
                  />
                </div>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--bg4)]">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(pct, 1)}%`, backgroundColor: color }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
