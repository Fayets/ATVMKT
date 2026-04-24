'use client'

import { useState, useEffect, useCallback } from 'react'
import { useToast } from '@/shared/components/toast'
import { useSupabase } from '@/shared/hooks/use-supabase'

export default function AjustesPage() {
  const { toast } = useToast()
  const { supabase, ready, userId } = useSupabase()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async () => {
    if (!ready) return
    if (userId) {
      const { data: { user } } = await supabase.auth.getUser()
      setEmail(user?.email || '')
      const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', userId).single()
      setName(profile?.full_name || '')
    }
    setLoading(false)
  }, [ready, userId, supabase])

  useEffect(() => { loadProfile() }, [loadProfile])

  const saveName = async () => {
    if (!userId) return
    await supabase.from('profiles').update({ full_name: name, updated_at: new Date().toISOString() }).eq('id', userId)
    toast('Nombre actualizado ✓')
  }

  const exportData = async () => {
    const tables = ['content_items', 'leads', 'bio_entries', 'referral_entries', 'deferred_entries', 'team_members', 'objectives', 'master_lists', 'account_metrics'] as const
    const backup: Record<string, unknown> = {}
    for (const table of tables) {
      const { data } = await supabase.from(table).select('*')
      backup[table] = data || []
    }
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `laboratorio-backup-${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    toast('Datos exportados ✓')
  }

  if (loading) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold tracking-tight">Ajustes</h2>
        <p className="mt-1 text-[12px] text-[var(--text3)]">Configuracion de la cuenta</p>
      </div>

      <div className="max-w-lg space-y-6">
        {/* Profile */}
        <div className="glass-card p-6">
          <h3 className="mb-4 text-[11px] font-medium uppercase tracking-widest text-[var(--text3)]">Perfil</h3>
          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Email</label>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text2)]">{email}</div>
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Nombre</label>
              <input
                type="text" value={name} onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
              />
            </div>
            <button onClick={saveName} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-[11px] font-semibold uppercase text-white hover:opacity-90">
              Guardar
            </button>
          </div>
        </div>

        {/* Export */}
        <div className="glass-card p-6">
          <h3 className="mb-4 text-[11px] font-medium uppercase tracking-widest text-[var(--text3)]">Datos</h3>
          <button
            onClick={exportData}
            className="rounded-lg border border-[var(--border2)] px-5 py-2 text-[11px] font-semibold uppercase text-[var(--text2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            Exportar datos (JSON)
          </button>
          <p className="mt-2 text-[11px] text-[var(--text3)]">Descarga un backup completo de todos tus datos</p>
        </div>
      </div>
    </div>
  )
}
