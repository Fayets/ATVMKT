'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { apiFetch } from '@/lib/api'
import { useToast } from '@/shared/components/toast'
import { useAuthUser } from '@/shared/hooks/use-auth-user'

const AR_TZ = 'America/Argentina/Buenos_Aires'

type KeywordClientRow = {
  lead_id: string
  nombre: string
  instagram: string
  reel_permalink: string | null
  reel_published_at: string | null
  keyword: string
}

type KeywordsResponse = {
  rows?: KeywordClientRow[]
  total?: number
}

/** `reel_published_at` viene como YYYY-MM-DD desde la API. */
function formatReelLabel(isoDate: string | null): string {
  if (!isoDate?.trim()) return 'REEL'
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim())
  if (m) {
    const [, y, mo, d] = m
    return `REEL ${d}/${mo}/${y}`
  }
  const t = Date.parse(isoDate)
  if (Number.isNaN(t)) return 'REEL'
  return `REEL ${new Date(t).toLocaleDateString('es-AR', { timeZone: AR_TZ, day: '2-digit', month: '2-digit', year: 'numeric' })}`
}

export default function KeywordsPage() {
  const { toast } = useToast()
  const { ready } = useAuthUser()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<KeywordClientRow[]>([])
  const [search, setSearch] = useState('')

  const fetchKeywords = useCallback(async () => {
    if (!ready) return
    setLoading(true)
    try {
      const res = await apiFetch('/keywords')
      const data = (await res.json().catch(() => ({}))) as KeywordsResponse
      if (!res.ok) {
        const detail =
          typeof data === 'object' && data && 'detail' in data
            ? String((data as { detail: unknown }).detail)
            : res.statusText
        toast(`Error al cargar Keyword: ${detail}`)
        setRows([])
        return
      }
      setRows(Array.isArray(data.rows) ? data.rows : [])
    } catch (e) {
      toast(`Error al cargar Keyword: ${(e as Error).message}`)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [ready, toast])

  useEffect(() => {
    fetchKeywords()
  }, [fetchKeywords])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => {
      const reelBit = [r.reel_published_at || '', formatReelLabel(r.reel_published_at).toLowerCase()].join(' ')
      const blob = [r.nombre, r.instagram, reelBit, r.keyword].join(' ').toLowerCase()
      return blob.includes(q)
    })
  }, [rows, search])

  if (!ready || loading) {
    return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Keyword</h2>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-[var(--bg4)] px-3 py-1 text-[11px] text-[var(--text3)]">
            {visible.length} de {rows.length} filas
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar nombre, IG, fecha o keyword…"
            className="w-64 rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--text3)]"
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="py-16 text-center text-[13px] text-[var(--text3)]">
          No hay leads con keyword. Cuando ManyChat guarde la keyword en el lead, van a aparecer acá.
        </div>
      ) : (
        <div className="space-y-2">
          <div className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,140px)_minmax(0,100px)] gap-4 px-4 py-2 sm:grid">
            {['Nombre', 'Instagram', 'Reel', 'Keyword'].map((h) => (
              <div key={h} className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
                {h}
              </div>
            ))}
          </div>
          {visible.map((r) => {
            const hasReel = Boolean(r.reel_permalink || r.reel_published_at)
            const label = formatReelLabel(r.reel_published_at)
            return (
              <div key={`${r.lead_id}-${r.keyword}`} className="glass-card overflow-hidden">
                <div className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,140px)_minmax(0,100px)] sm:items-center sm:gap-4">
                  <div className="min-w-0 overflow-hidden text-[13px] text-[var(--text)]">
                    <span className="block truncate">{r.nombre || '—'}</span>
                  </div>
                  <div className="min-w-0 overflow-hidden text-[13px] text-[var(--text2)]">
                    <span className="block truncate">{r.instagram || '—'}</span>
                  </div>
                  <div className="min-w-0 overflow-hidden text-[12px]">
                    {r.reel_permalink ? (
                      <a
                        href={r.reel_permalink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate font-medium whitespace-nowrap text-[var(--accent)] hover:underline"
                        title={label}
                      >
                        {label}
                      </a>
                    ) : hasReel ? (
                      <span className="block truncate whitespace-nowrap text-[var(--text2)]">{label}</span>
                    ) : (
                      <span className="block truncate text-[var(--text3)]">—</span>
                    )}
                  </div>
                  <div className="min-w-0 overflow-hidden text-[13px] font-medium text-[var(--text)]">
                    <span className="block truncate">{r.keyword}</span>
                  </div>
                </div>
              </div>
            )
          })}
          {visible.length === 0 && (
            <div className="py-8 text-center text-[12px] text-[var(--text3)]">Ninguna fila coincide con la búsqueda.</div>
          )}
        </div>
      )}
    </div>
  )
}
