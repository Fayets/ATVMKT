'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { useToast } from '@/shared/components/toast'
import { getCallReports } from '../services/call-reports-service'
import type { CallReport } from '../types'
import { CallReportsTable } from './CallReportsTable'

const POLL_MS = 5000

function hasPending(items: CallReport[]): boolean {
  return items.some((r) => r.estado === 'pendiente' || r.estado === 'procesando')
}

export function CallReportsPage() {
  const { ready, userId } = useAuthUser()
  const { toast } = useToast()
  const [items, setItems] = useState<CallReport[]>([])
  const [loading, setLoading] = useState(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchReports = useCallback(async (silent = false) => {
    if (!ready || !userId) {
      setItems([])
      setLoading(false)
      return
    }
    if (!silent) setLoading(true)
    try {
      const rows = await getCallReports()
      setItems(rows)
    } catch (e) {
      if (!silent) {
        toast(e instanceof Error ? e.message : 'Error al cargar reportes.')
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [ready, userId, toast])

  useEffect(() => {
    void fetchReports()
  }, [fetchReports])

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (!ready || !userId) return undefined
    if (!hasPending(items)) return undefined

    pollRef.current = setInterval(() => {
      void fetchReports(true)
    }, POLL_MS)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [items, ready, userId, fetchReports])

  if (!ready) {
    return <div className="py-12 text-[13px] text-[var(--text3)]">Cargando sesión…</div>
  }

  if (!userId) {
    return <div className="py-12 text-[13px] text-[var(--text3)]">Iniciá sesión para ver los reportes.</div>
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-bold tracking-tight">Reporte calls</h2>
        <p className="mt-1 text-[12px] text-[var(--text3)]">
          Análisis automático de llamadas Fathom. Se generan al pegar el link en Leads.
        </p>
      </div>
      <CallReportsTable items={items} loading={loading} />
    </div>
  )
}
