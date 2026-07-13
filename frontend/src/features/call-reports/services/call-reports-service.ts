import { apiFetch } from '@/lib/api'
import type { CallReport } from '../types'

type ListResponse = {
  call_reports?: CallReport[]
}

export async function getCallReports(): Promise<CallReport[]> {
  const res = await apiFetch('/call-reports')
  const raw = (await res.json().catch(() => ({}))) as ListResponse & { detail?: string }
  if (!res.ok) {
    throw new Error(typeof raw.detail === 'string' ? raw.detail : 'No se pudieron cargar los reportes.')
  }
  return Array.isArray(raw.call_reports) ? raw.call_reports : []
}

export async function getCallReport(id: string): Promise<CallReport> {
  const res = await apiFetch(`/call-reports/${encodeURIComponent(id)}`)
  const raw = (await res.json().catch(() => ({}))) as CallReport & { detail?: string }
  if (!res.ok) {
    throw new Error(typeof raw.detail === 'string' ? raw.detail : 'Reporte no encontrado.')
  }
  return raw as CallReport
}
