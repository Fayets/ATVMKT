export type Lead = {
  id: string
  /** user_id del dueño en BD (Pony Lead.user_id) */
  lead_user_id?: string | null
  client_name: string
  ig_handle: string | null
  phone: string | null
  avatar_type: string | null
  status: string
  origin: string | null
  entry_channel: string | null
  entry_funnel: string | null
  /** keyword en BD (mismo valor que suele mostrarse en ingreso embudo) */
  keyword?: string | null
  agenda_point: string | null
  ctas_responded: number
  first_contact_at: string | null
  fecha_bot?: string | null
  scheduled_at: string | null
  agendo?: boolean | null
  call_at: string | null
  call?: boolean | null
  call_link: string | null
  closer_report: string | null
  program_offered: string | null
  program_purchased: string | null
  revenue: number
  payment: number
  owed: number
  closer: string | null
  setter: string | null
  notes: string | null
  date: string
  month: string | null
  // Campos Calendly
  email: string | null
  dolores_setting: string | null
  dolores_setting_detail: string | null
  dolores_llamada: string | null
  razon_compra: string | null
  pago_en_llamada: number
  dias_agendamiento: number | null
  ingresos_mensuales: number
  compromiso: string | null
  urgencia: string | null
  disposicion_invertir: string | null
  calendly_event_uri: string | null
  calendly_invitee_uri: string | null
  /** Origen del registro (manual, import, etc.). */
  source_type?: string | null
  content_url?: string | null
  manychat_contact_id?: string | null
  respondio_auto?: boolean | null
}

export type ColumnDef = {
  key: string
  label: string
  width: number
  type: 'text' | 'number' | 'date' | 'select' | 'badge' | 'link' | 'currency'
  editable?: boolean
  options?: string[]
  colors?: Record<string, string>
  sticky?: boolean
  defaultVisible?: boolean
}

export type SortConfig = {
  field: string
  dir: 'asc' | 'desc'
}

export type FilterConfig = {
  field: string
  operator: 'contains' | 'equals' | 'gt' | 'lt' | 'empty' | 'not_empty'
  value: string
}

export const STATUS_COLORS: Record<string, string> = {
  Cerrado: '#4ADE80',
  Seguimiento: '#60A5FA',
  'Seña': '#FBBF24',
  'No show': '#F87171',
  'Re-agenda': '#FB923C',
  Descalificado: '#A855F7',
  Pendiente: '#94A3B8',
}

export const AVATAR_COLORS: Record<string, string> = {
  'Experto en info': '#3B82F6',
  'Dueño de agencia': '#A855F7',
  'Dueño de negocio': '#F59E0B',
  'Habilidades de alto valor': '#EC4899',
  'Creador de contenido': '#22C55E',
  'Creador con infoproducto': '#06B6D4',
  'Otro': '#6B7280',
}

export const CHANNEL_COLORS: Record<string, string> = {
  'IG Chat': '#E1306C',
  'WSP Chat': '#25D366',
  'Referido': '#F59E0B',
  'YouTube': '#FF0000',
}

export const PROGRAM_COLORS: Record<string, string> = {
  Boost: '#F59E0B',
  Advantage: '#3B82F6',
  Mentoria: '#22C55E',
}

export const STATUS_OPTIONS = ['Pendiente', 'Seguimiento', 'Seña', 'Cerrado', 'No show', 'Re-agenda', 'Descalificado']
export const AVATAR_OPTIONS = ['', 'Experto en info', 'Dueño de agencia', 'Dueño de negocio', 'Habilidades de alto valor', 'Creador de contenido', 'Creador con infoproducto', 'Otro']
export const PROGRAM_OPTIONS = ['', 'Boost', 'Advantage', 'Mentoria']
export const CHANNEL_OPTIONS = ['', 'IG Chat', 'WSP Chat', 'Referido', 'YouTube']
export const ORIGIN_OPTIONS = ['Referido', 'Setter', 'Youtube', 'Lead viejo (seguimiento)'] as const

export const ORIGIN_COLORS: Record<string, string> = {
  Referido: '#F59E0B',
  Setter: '#3B82F6',
  Youtube: '#FF0000',
  'Lead viejo (seguimiento)': '#A855F7',
}

export const STATUS_TABS = ['Todos', 'Cerrados', 'Seguimiento', 'No show', 'Pendiente', 'Descalificado']

function normStatusKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
}

/**
 * Unifica variantes de texto libre al valor canónico de STATUS_OPTIONS
 * para filtros, colores y selects.
 */
export function canonicalLeadStatus(raw: string | null | undefined): string {
  const s = (raw ?? '').trim()
  if (!s) return 'Pendiente'
  const n = normStatusKey(s)
  const synonyms: Record<string, string> = {
    cerrado: 'Cerrado',
    cerrados: 'Cerrado',
    closed: 'Cerrado',
    won: 'Cerrado',
    seguimiento: 'Seguimiento',
    'en seguimiento': 'Seguimiento',
    follow: 'Seguimiento',
    'follow up': 'Seguimiento',
    'no show': 'No show',
    noshow: 'No show',
    'no asistio': 'No show',
    'no asistió': 'No show',
    pendiente: 'Pendiente',
    pending: 'Pendiente',
    descalificado: 'Descalificado',
    disqualificado: 'Descalificado',
    disqualified: 'Descalificado',
    're-agenda': 'Re-agenda',
    're agenda': 'Re-agenda',
    reagenda: 'Re-agenda',
    seña: 'Seña',
    sena: 'Seña',
  }
  if (synonyms[n]) return synonyms[n]
  const fromOptions = STATUS_OPTIONS.find((o) => normStatusKey(o) === n)
  if (fromOptions) return fromOptions
  return s
}

export const SETTER_COLORS: Record<string, string> = {
  _default: '#3B82F6',
}

export const CLOSER_COLORS: Record<string, string> = {
  _default: '#8B5CF6',
}

export function buildColumns(setterNames: string[], closerNames: string[]): ColumnDef[] {
  return [
    // Datos de contacto
    { key: 'client_name', label: 'Nombre', width: 160, type: 'text', editable: true, sticky: true, defaultVisible: true },
    { key: 'ig_handle', label: 'IG', width: 130, type: 'text', editable: true, defaultVisible: true },
    { key: 'phone', label: 'Tel', width: 140, type: 'text', editable: true, defaultVisible: true },
    { key: 'email', label: 'Email', width: 180, type: 'text', editable: true, defaultVisible: true },
    { key: 'avatar_type', label: 'Avatar', width: 170, type: 'badge', editable: true, options: AVATAR_OPTIONS, colors: AVATAR_COLORS, defaultVisible: true },
    // Estado y equipo
    { key: 'status', label: 'Status', width: 130, type: 'select', editable: true, options: STATUS_OPTIONS, colors: STATUS_COLORS, defaultVisible: true },
    { key: 'origin', label: 'Origen', width: 200, type: 'select', editable: true, options: [...ORIGIN_OPTIONS], colors: ORIGIN_COLORS, defaultVisible: true },
    { key: 'entry_channel', label: 'Vía', width: 110, type: 'badge', editable: true, options: CHANNEL_OPTIONS, colors: CHANNEL_COLORS, defaultVisible: true },
    // Funnel de entrada
    { key: 'entry_funnel', label: 'Ingreso embudo', width: 150, type: 'text', editable: true, defaultVisible: true },
    { key: 'agenda_point', label: 'Pto agenda', width: 130, type: 'text', editable: true, defaultVisible: true },
    { key: 'ctas_responded', label: 'CTAs resp.', width: 90, type: 'number', editable: true, defaultVisible: true },
    // Fechas
    { key: 'first_contact_at', label: '1er contacto', width: 120, type: 'date', editable: true, defaultVisible: true },
    { key: 'scheduled_at', label: 'Agendó', width: 110, type: 'date', editable: true, defaultVisible: true },
    { key: 'call_at', label: 'Call', width: 110, type: 'date', editable: true, defaultVisible: true },
    // Setting (pre-llamada)
    { key: 'setter', label: 'Setter', width: 110, type: 'badge', editable: true, options: ['', ...setterNames], colors: Object.fromEntries(setterNames.map(n => [n, '#3B82F6'])), defaultVisible: true },
    { key: 'dolores_setting', label: 'Dolores setting', width: 200, type: 'text', editable: true, defaultVisible: true },
    { key: 'dolores_setting_detail', label: 'Detalle dolores', width: 220, type: 'text', editable: true, defaultVisible: true },
    { key: 'ingresos_mensuales', label: 'Ingresos lead', width: 130, type: 'currency', editable: true, defaultVisible: true },
    // Llamada (closer)
    { key: 'closer', label: 'Closer', width: 110, type: 'badge', editable: true, options: ['', ...closerNames], colors: Object.fromEntries(closerNames.map(n => [n, '#8B5CF6'])), defaultVisible: true },
    { key: 'call_link', label: 'Llamada', width: 110, type: 'link', editable: true, defaultVisible: true },
    { key: 'closer_report', label: 'Reporte closer', width: 200, type: 'text', editable: true, defaultVisible: true },
    { key: 'dolores_llamada', label: 'Dolores llamada', width: 200, type: 'text', editable: true, defaultVisible: true },
    { key: 'razon_compra', label: 'Razón compra', width: 200, type: 'text', editable: true, defaultVisible: true },
    // Venta
    { key: 'program_offered', label: 'Prog. ofrecido', width: 130, type: 'badge', editable: true, options: PROGRAM_OPTIONS, colors: PROGRAM_COLORS, defaultVisible: true },
    { key: 'program_purchased', label: 'Prog. comprado', width: 140, type: 'badge', editable: true, options: PROGRAM_OPTIONS, colors: PROGRAM_COLORS, defaultVisible: true },
    { key: 'pago_en_llamada', label: 'Pago en llamada', width: 130, type: 'currency', editable: true, defaultVisible: true },
    { key: 'payment', label: 'Pagó', width: 100, type: 'currency', editable: true, defaultVisible: true },
    { key: 'owed', label: 'Debe', width: 100, type: 'currency', editable: true, defaultVisible: true },
    // Calificación Calendly
    { key: 'compromiso', label: 'Compromiso', width: 200, type: 'text', editable: true, defaultVisible: false },
    { key: 'urgencia', label: 'Urgencia', width: 180, type: 'text', editable: true, defaultVisible: false },
    { key: 'disposicion_invertir', label: 'Disp. invertir', width: 180, type: 'text', editable: true, defaultVisible: false },
    // Extras
    { key: 'revenue', label: 'Facturación', width: 110, type: 'currency', editable: true, defaultVisible: false },
    { key: 'date', label: 'Fecha', width: 110, type: 'date', editable: true, defaultVisible: false },
    { key: 'notes', label: 'Notas', width: 200, type: 'text', editable: true, defaultVisible: false },
    { key: 'calendly_event_uri', label: 'Calendly (evento)', width: 160, type: 'link', editable: true, defaultVisible: false },
    { key: 'calendly_invitee_uri', label: 'Calendly (invitado)', width: 160, type: 'link', editable: true, defaultVisible: false },
    // Paridad con modelo Pony Lead (Neon)
    { key: 'lead_user_id', label: 'User cuenta', width: 96, type: 'text', editable: false, defaultVisible: false },
    { key: 'keyword', label: 'Keyword (BD)', width: 120, type: 'text', editable: false, defaultVisible: false },
    { key: 'fecha_bot', label: 'Fecha bot', width: 130, type: 'date', editable: false, defaultVisible: false },
    { key: 'agendo', label: 'Agendó', width: 88, type: 'text', editable: false, defaultVisible: false },
    { key: 'call', label: 'Call', width: 72, type: 'text', editable: false, defaultVisible: false },
    { key: 'content_url', label: 'Content URL', width: 160, type: 'link', editable: false, defaultVisible: false },
    { key: 'manychat_contact_id', label: 'ManyChat ID', width: 130, type: 'text', editable: false, defaultVisible: false },
    { key: 'respondio_auto', label: 'Resp. auto', width: 96, type: 'text', editable: false, defaultVisible: false },
    { key: 'source_type', label: 'Origen reg.', width: 110, type: 'text', editable: false, defaultVisible: false },
  ]
}
