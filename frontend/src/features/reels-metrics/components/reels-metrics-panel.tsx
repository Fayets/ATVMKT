'use client'

import { useEffect, useMemo, useState } from 'react'
import { Bar } from '@/shared/components/charts'
import { useSupabase } from '@/shared/hooks/use-supabase'

type ReelRow = {
  id: string
  title: string | null
  url: string | null
  published_at?: string | null
  keyword?: string | null
  chats?: number
  metrics?: Record<string, unknown>
}

type ReelsResponse = {
  reels: ReelRow[]
  total_pages: number
}

type ReelMetricItem = {
  id: string
  title: string
  url: string | null
  publishedAt: string | null
  keyword: string | null
  year: number | null
  chats: number
  views: number
  comments: number
  likes: number
  shares: number
}

const API_BASE = ((process.env.NEXT_PUBLIC_BACKEND_URL || '').trim().replace(/\/$/, '') || '/api-backend')

export function ReelsMetricsPanel() {
  const { ready, userId } = useSupabase()
  const [rows, setRows] = useState<ReelMetricItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedYear, setSelectedYear] = useState<string>('all')
  const [selectedReel, setSelectedReel] = useState<ReelMetricItem | null>(null)

  useEffect(() => {
    if (!ready || !userId) return
    let cancelled = false

    const run = async () => {
      setLoading(true)
      try {
        const collected: ReelRow[] = []
        let page = 1
        let totalPages = 1
        while (page <= totalPages && page <= 10) {
          const res = await fetch(`${API_BASE}/api/reels?page=${page}&page_size=50`, {
            headers: { 'X-User-Id': userId },
          })
          const data = (await res.json()) as ReelsResponse
          const pageRows = Array.isArray(data.reels) ? data.reels : []
          collected.push(...pageRows)
          totalPages = Math.max(1, Number(data.total_pages || 1))
          page += 1
        }

        const mapped: ReelMetricItem[] = collected.map((r) => {
          const views = Number(r.metrics?.plays || 0)
          const comments = Number(r.metrics?.comments_count ?? r.metrics?.comments ?? 0)
          const likes = Number(r.metrics?.likes || 0)
          const shares = Number(r.metrics?.shares || 0)
          return {
            id: r.id,
            title: (r.title || 'Reel sin titulo').slice(0, 48),
            url: r.url || null,
            publishedAt: r.published_at || null,
            keyword: r.keyword || null,
            year: r.published_at ? new Date(r.published_at).getFullYear() : null,
            chats: Number(r.chats || 0),
            views,
            comments,
            likes,
            shares,
          }
        })
        if (!cancelled) setRows(mapped)
      } catch {
        if (!cancelled) setRows([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [ready, userId])

  const years = useMemo(() => {
    return [...new Set(rows.map((r) => r.year).filter((y): y is number => y !== null))].sort((a, b) => b - a)
  }, [rows])
  const filteredRows = useMemo(() => {
    if (selectedYear === 'all') return rows
    const yearNum = Number(selectedYear)
    return rows.filter((r) => r.year === yearNum)
  }, [rows, selectedYear])
  const topViews = useMemo(
    () => [...filteredRows].sort((a, b) => b.views - a.views).slice(0, 8),
    [filteredRows]
  )
  const topComments = useMemo(
    () => [...filteredRows].sort((a, b) => b.comments - a.comments).slice(0, 8),
    [filteredRows]
  )
  const topLikes = useMemo(
    () => [...filteredRows].sort((a, b) => b.likes - a.likes).slice(0, 8),
    [filteredRows]
  )
  const topChats = useMemo(
    () => [...filteredRows].sort((a, b) => b.chats - a.chats).slice(0, 8),
    [filteredRows]
  )

  if (loading) {
    return <div className="glass-card p-6 text-[12px] text-[var(--text3)]">Cargando métricas de reels...</div>
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-end">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--text3)] uppercase tracking-wider">Año</span>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value)}
            className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-1.5 text-[12px] text-[var(--text)] outline-none"
          >
            <option value="all">Todos</option>
            {years.map((y) => (
              <option key={y} value={String(y)}>{y}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="glass-card p-5">
        <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Top reels por vistas</div>
        <div className="mb-3 text-[12px] font-semibold">MAS VISTOS</div>
        <div className="h-80">
          <Bar
            data={{
              labels: topViews.map((r) => r.title),
              datasets: [{ data: topViews.map((r) => r.views), backgroundColor: 'rgba(34,197,94,0.65)' }],
            }}
            options={{
              indexAxis: 'y',
              maintainAspectRatio: false,
              onClick: (_, elements) => {
                if (!elements.length) return
                const idx = elements[0].index
                const reel = topViews[idx]
                if (reel) setSelectedReel(reel)
              },
              scales: {
                x: { ticks: { color: '#a1a1aa' }, grid: { color: 'rgba(255,255,255,0.06)' } },
                y: { ticks: { color: '#a1a1aa', font: { size: 10 } }, grid: { display: false } },
              },
              plugins: { legend: { display: false } },
            }}
          />
        </div>
      </div>

      <div className="glass-card p-5">
        <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Top reels por comentarios</div>
        <div className="mb-3 text-[12px] font-semibold">MAS COMENTADOS</div>
        <div className="h-80">
          <Bar
            data={{
              labels: topComments.map((r) => r.title),
              datasets: [{ label: 'Comentarios', data: topComments.map((r) => r.comments), backgroundColor: 'rgba(59,130,246,0.65)' }],
            }}
            options={{
              indexAxis: 'y',
              maintainAspectRatio: false,
              onClick: (_, elements) => {
                if (!elements.length) return
                const idx = elements[0].index
                const reel = topComments[idx]
                if (reel) setSelectedReel(reel)
              },
              scales: {
                x: { ticks: { color: '#a1a1aa' }, grid: { color: 'rgba(255,255,255,0.06)' } },
                y: { ticks: { color: '#a1a1aa', font: { size: 10 } }, grid: { display: false } },
              },
              plugins: { legend: { display: false } },
            }}
          />
        </div>
      </div>

      <div className="glass-card p-5">
        <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Top reels por likes</div>
        <div className="mb-3 text-[12px] font-semibold">MAS LIKES</div>
        <div className="h-80">
          <Bar
            data={{
              labels: topLikes.map((r) => r.title),
              datasets: [{ label: 'Likes', data: topLikes.map((r) => r.likes), backgroundColor: 'rgba(239,68,68,0.65)' }],
            }}
            options={{
              indexAxis: 'y',
              maintainAspectRatio: false,
              onClick: (_, elements) => {
                if (!elements.length) return
                const idx = elements[0].index
                const reel = topLikes[idx]
                if (reel) setSelectedReel(reel)
              },
              scales: {
                x: { ticks: { color: '#a1a1aa' }, grid: { color: 'rgba(255,255,255,0.06)' } },
                y: { ticks: { color: '#a1a1aa' }, grid: { color: 'rgba(255,255,255,0.06)' } },
              },
              plugins: { legend: { display: false } },
            }}
          />
        </div>
      </div>

      <div className="glass-card p-5">
        <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Top reels por chats</div>
        <div className="mb-3 text-[12px] font-semibold">MAS CHATS</div>
        <div className="h-80">
          <Bar
            data={{
              labels: topChats.map((r) => r.title),
              datasets: [{ label: 'Chats', data: topChats.map((r) => r.chats), backgroundColor: 'rgba(168,85,247,0.65)' }],
            }}
            options={{
              indexAxis: 'y',
              maintainAspectRatio: false,
              onClick: (_, elements) => {
                if (!elements.length) return
                const idx = elements[0].index
                const reel = topChats[idx]
                if (reel) setSelectedReel(reel)
              },
              scales: {
                x: { ticks: { color: '#a1a1aa' }, grid: { color: 'rgba(255,255,255,0.06)' } },
                y: { ticks: { color: '#a1a1aa' }, grid: { color: 'rgba(255,255,255,0.06)' } },
              },
              plugins: { legend: { display: false } },
            }}
          />
        </div>
      </div>
      </div>
      {selectedReel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-xl rounded-xl border border-[var(--border)] bg-[var(--bg2)] p-5">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <div className="text-[15px] font-semibold">{selectedReel.title}</div>
                <div className="mt-1 text-[11px] text-[var(--text3)]">
                  {selectedReel.publishedAt ? selectedReel.publishedAt.split('T')[0] : 'Sin fecha'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedReel(null)}
                className="rounded-md bg-[var(--bg4)] px-3 py-1.5 text-[11px] text-[var(--text3)] hover:text-[var(--text)]"
              >
                Cerrar
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <MetricCard label="Vistas" value={selectedReel.views} />
              <MetricCard label="Chats" value={selectedReel.chats} />
              <MetricCard label="Comentarios" value={selectedReel.comments} />
              <MetricCard label="Likes" value={selectedReel.likes} />
              <MetricCard label="Compartidos" value={selectedReel.shares} />
              <KeywordCard value={selectedReel.keyword} />
            </div>

            {selectedReel.url && (
              <div className="mt-4">
                <a
                  href={selectedReel.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex rounded-md bg-[var(--accent)] px-3 py-2 text-[11px] font-semibold text-white"
                >
                  Ver reel en Instagram
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-[var(--bg4)] p-3 text-center">
      <div className="text-[9px] uppercase tracking-wider text-[var(--text3)]">{label}</div>
      <div className="font-mono-num mt-1 text-[18px] font-bold">{Number(value || 0).toLocaleString('es-AR')}</div>
    </div>
  )
}

function KeywordCard({ value }: { value: string | null }) {
  return (
    <div className="rounded-lg bg-[var(--bg4)] p-3 text-center">
      <div className="text-[9px] uppercase tracking-wider text-[var(--text3)]">Keyword</div>
      <div className="mt-1 truncate font-mono text-[16px] font-bold">
        {value && value.trim() ? value : 'Sin keyword'}
      </div>
    </div>
  )
}
