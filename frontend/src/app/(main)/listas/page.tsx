'use client'

import { useState, useEffect, useCallback } from 'react'
import { useToast } from '@/shared/components/toast'
import { useSupabase } from '@/shared/hooks/use-supabase'

const CATEGORIES = [
  { key: 'dolores', label: 'Dolores', defaults: ['No tiene tiempo', 'No sabe vender', 'No tiene sistema', 'Estancado en revenue', 'No tiene equipo'] },
  { key: 'angulos', label: 'Angulos', defaults: ['VSL Chat', 'Reporte del closer', 'Proceso de agendamiento corto', 'QuickCash', 'Evergreen Value', 'Metodo unico'] },
  { key: 'ctas', label: 'CTAs', defaults: ['INFO', 'SISTEMA', 'SOP', 'REPORTE', 'GRATIS'] },
]

export default function ListasMaestrasPage() {
  const { toast } = useToast()
  const { supabase, ready, userId } = useSupabase()
  const [lists, setLists] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(true)

  const fetchLists = useCallback(async () => {
    if (!ready) return
    setLoading(true)
    const { data } = await supabase.from('master_lists').select('category, items')
    const result: Record<string, string[]> = {}
    ;(data || []).forEach((row: { category: string; items: unknown }) => {
      result[row.category] = Array.isArray(row.items) ? row.items as string[] : []
    })
    setLists(result)
    setLoading(false)
  }, [ready, supabase])

  useEffect(() => { fetchLists() }, [fetchLists])

  const saveList = async (category: string, items: string[]) => {
    if (!userId) return
    await supabase.from('master_lists').upsert(
      { user_id: userId, category, items, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,category' }
    )
    setLists(prev => ({ ...prev, [category]: items }))
  }

  const addItem = async (category: string, value: string) => {
    if (!value.trim()) return
    const current = lists[category] || []
    if (current.includes(value.trim())) { toast('Ya existe'); return }
    const updated = [...current, value.trim()]
    await saveList(category, updated)
    toast('Agregado ✓')
  }

  const removeItem = async (category: string, value: string) => {
    const updated = (lists[category] || []).filter(v => v !== value)
    await saveList(category, updated)
    toast('Eliminado ✓')
  }

  const seedDefaults = async (category: string, defaults: string[]) => {
    await saveList(category, defaults)
    toast('Lista restaurada ✓')
  }

  if (loading) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold tracking-tight">Listas Maestras</h2>
        <p className="mt-1 text-[12px] text-[var(--text3)]">Configuracion de dolores, angulos y CTAs para clasificacion de contenido</p>
      </div>

      <div className="space-y-6">
        {CATEGORIES.map((cat) => {
          const items = lists[cat.key] || []
          return (
            <div key={cat.key} className="glass-card p-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--text2)]">{cat.label}</h3>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-[var(--bg4)] px-3 py-0.5 font-mono-num text-[11px] text-[var(--text3)]">{items.length}</span>
                  {items.length === 0 && (
                    <button
                      onClick={() => seedDefaults(cat.key, cat.defaults)}
                      className="text-[10px] text-[var(--accent)] hover:underline"
                    >
                      Cargar defaults
                    </button>
                  )}
                </div>
              </div>

              <div className="mb-4 flex flex-wrap gap-2">
                {items.map((item) => (
                  <span key={item} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--bg3)] px-3 py-1.5 text-[12px] text-[var(--text)]">
                    {item}
                    <button onClick={() => removeItem(cat.key, item)} className="text-[var(--text3)] hover:text-[var(--red)] text-[13px]">×</button>
                  </span>
                ))}
              </div>

              <AddItemInput onAdd={(val) => addItem(cat.key, val)} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AddItemInput({ onAdd }: { onAdd: (val: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <div className="flex gap-2">
      <input
        type="text" value={value} onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { onAdd(value); setValue('') } }}
        placeholder="Agregar nuevo..."
        className="flex-1 rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
      />
      <button
        onClick={() => { onAdd(value); setValue('') }}
        className="rounded-lg border border-[var(--border2)] px-4 py-2 text-[11px] font-semibold uppercase text-[var(--text2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
      >
        Agregar
      </button>
    </div>
  )
}
