import { createClient } from '@/lib/supabase/client'

// Generic typed query helpers for client-side CRUD
export function getSupabase() {
  return createClient()
}

export function getMonthRange(month: string): { start: string; end: string } {
  const [year, m] = month.split('-').map(Number)
  const start = new Date(year, m - 1, 1).toISOString()
  const end = new Date(year, m, 0, 23, 59, 59).toISOString()
  return { start, end }
}

export function formatCash(n: number): string {
  return '$' + Math.round(n).toLocaleString('es-AR')
}

export function formatK(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return Math.round(n / 1000) + 'K'
  return n.toLocaleString()
}
