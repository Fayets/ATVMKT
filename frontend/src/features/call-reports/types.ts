export type CallReportEstado = 'pendiente' | 'procesando' | 'listo' | 'error'

export type CallReport = {
  id: string
  lead_id: string
  lead_nombre: string
  fathom_url: string
  estado: CallReportEstado | string
  error_msg: string | null
  participantes: string | null
  motivo_reunion: string | null
  resumen: string | null
  hubo_objeciones: string | null
  tipo_perfil: string | null
  ingresos_estimados: string | null
  situacion_y_deseo: string | null
  closer_report: string | null
  dolores_llamada: string | null
  razon_compra: string | null
  program_offered: string | null
  status_llamada: string | null
  created_at: string
  updated_at: string | null
}

export const ESTADO_COLORS: Record<string, string> = {
  pendiente: '#94A3B8',
  procesando: '#60A5FA',
  listo: '#22C55E',
  error: '#F87171',
}

export const ESTADO_LABELS: Record<string, string> = {
  pendiente: 'Pendiente',
  procesando: 'Procesando',
  listo: 'Listo',
  error: 'Error',
}
