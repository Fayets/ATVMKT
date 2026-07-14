import { apiFetch, backendAuthHeaders } from '@/lib/api'
import type { CallReport } from '../types'

const API_BASE =
  (process.env.NEXT_PUBLIC_BACKEND_URL || '').trim().replace(/\/$/, '') || '/api-backend'

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

export async function deleteCallReport(id: string): Promise<void> {
  const res = await apiFetch(`/call-reports/${encodeURIComponent(id)}`, { method: 'DELETE' })
  const raw = (await res.json().catch(() => ({}))) as { detail?: string }
  if (!res.ok) {
    throw new Error(typeof raw.detail === 'string' ? raw.detail : 'No se pudo eliminar el reporte.')
  }
}

export async function bulkDeleteCallReports(ids: string[]): Promise<number> {
  const res = await apiFetch('/call-reports/bulk-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: ids.map((id) => Number(id)).filter((n) => Number.isFinite(n)) }),
  })
  const raw = (await res.json().catch(() => ({}))) as { deleted?: number; detail?: string }
  if (!res.ok) {
    throw new Error(typeof raw.detail === 'string' ? raw.detail : 'No se pudieron eliminar los reportes.')
  }
  return typeof raw.deleted === 'number' ? raw.deleted : 0
}

async function downloadBlob(path: string, init?: RequestInit, fallbackName = 'reporte'): Promise<void> {
  const headers = backendAuthHeaders(init?.headers)
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const res = await fetch(`${API_BASE}/api${normalizedPath}`, { ...init, headers })
  if (!res.ok) {
    const raw = (await res.json().catch(() => ({}))) as { detail?: string }
    throw new Error(typeof raw.detail === 'string' ? raw.detail : 'No se pudo descargar.')
  }
  const blob = await res.blob()
  const cd = res.headers.get('Content-Disposition') || ''
  const match = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd)
  const name = decodeURIComponent(match?.[1] || match?.[2] || fallbackName)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function downloadCallReport(id: string, format: 'pdf' | 'txt'): Promise<void> {
  await downloadBlob(
    `/call-reports/${encodeURIComponent(id)}/download?format=${format}`,
    { method: 'GET' },
    `reporte_(Sin nombre).${format}`,
  )
}

export async function bulkDownloadCallReports(ids: string[], format: 'pdf' | 'txt'): Promise<void> {
  await downloadBlob(
    `/call-reports/bulk-download?format=${format}`,
    {
      method: 'POST',
      body: JSON.stringify({ ids: ids.map((id) => Number(id)).filter((n) => Number.isFinite(n)) }),
    },
    `reporte_(Sin nombre).${format}`,
  )
}
