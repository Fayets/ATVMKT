import { type Lead, canonicalLeadStatus } from '../types'

function normKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
}

function scalar(v: unknown): string | number | null {
  if (v == null) return null
  if (typeof v === 'string' || typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 'Sí' : 'No'
  if (typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    if (typeof o.name === 'string') return o.name
    if (typeof o.email === 'string') return o.email
    if (typeof o.url === 'string') return o.url
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return null
    const parts = v.map((x) => {
      if (x && typeof x === 'object') {
        const o = x as Record<string, unknown>
        if (typeof o.url === 'string') return o.url
        if (typeof o.name === 'string') return o.name
      }
      return scalar(x)
    })
    return parts.filter((p) => p != null && p !== '').join(', ')
  }
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function str(v: unknown, fallback = ''): string {
  const s = scalar(v)
  if (s == null) return fallback
  return String(s)
}

function num(v: unknown): number {
  const s = scalar(v)
  if (s == null) return 0
  const n = Number(String(s).replace(/[^0-9.,-]/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function monthFromValue(v: unknown): string | null {
  const s = str(v)
  if (/^\d{4}-\d{2}$/.test(s)) return s
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 7)
  return null
}

/** Elige el primer campo cuyo nombre coincide con algún alias (insensible a acentos / mayúsculas). */
/**
 * Resuelve el valor por lista de alias. Importante: recorre **aliases en orden** y luego las
 * columnas, para preferir p. ej. "Nombre" antes que "Name" aunque Airtable envíe las claves en otro orden.
 */
function pick(
  fields: Record<string, unknown>,
  aliases: string[],
  mappedKeys: Set<string>,
): unknown {
  const keys = Object.keys(fields)
  for (const a of aliases) {
    const na = normKey(a)
    for (const k of keys) {
      if (mappedKeys.has(k)) continue
      if (normKey(k) === na) {
        mappedKeys.add(k)
        return fields[k]
      }
    }
  }
  return undefined
}

/** Primera columna cuyo nombre contiene todos los fragmentos (para headers truncados en Airtable). */
function pickContainsAll(
  fields: Record<string, unknown>,
  fragments: string[],
  mappedKeys: Set<string>,
): unknown {
  for (const k of Object.keys(fields)) {
    if (mappedKeys.has(k)) continue
    const nk = normKey(k)
    if (fragments.every((f) => nk.includes(normKey(f)))) {
      mappedKeys.add(k)
      return fields[k]
    }
  }
  return undefined
}

/** Primera columna cuyo nombre empieza con el prefijo (normalizado). */
function pickStartsWith(
  fields: Record<string, unknown>,
  prefix: string,
  mappedKeys: Set<string>,
): unknown {
  const np = normKey(prefix)
  for (const k of Object.keys(fields)) {
    if (mappedKeys.has(k)) continue
    if (normKey(k).startsWith(np)) {
      mappedKeys.add(k)
      return fields[k]
    }
  }
  return undefined
}

export function mapAirtableRecordToLead(rec: {
  id: string
  createdTime?: string
  fields: Record<string, unknown>
}): Lead {
  const f = rec.fields || {}
  const mappedKeys = new Set<string>()

  const client_name = str(pick(f, ['Nombre', 'Name', 'Cliente', 'Lead', 'Contacto', 'Full name'], mappedKeys), 'Sin nombre')
  const ig_handle = str(pick(f, ['Instagram', 'IG', 'Ig', 'IG handle', 'Usuario Instagram', 'ig_username'], mappedKeys), '') || null
  const phone = str(pick(f, ['Tel', 'Teléfono', 'Telefono', 'Phone', 'Móvil', 'WhatsApp'], mappedKeys), '') || null
  const email = str(pick(f, ['Email', 'Correo', 'Mail'], mappedKeys), '') || null
  const avatar_type = str(pick(f, ['Avatar', 'Avatar type', 'Tipo avatar'], mappedKeys), '') || null

  const status = str(
    pick(f, ['Estado', 'Status', 'Etapa', 'Stage', 'Estado lead', 'Pipeline'], mappedKeys),
    'Pendiente',
  )
  const origin = str(pick(f, ['Origen', 'Origin', 'Fuente', 'Source'], mappedKeys), '') || null
  /** "Vía" en Airtable suele ser Perfil / Historia / Reel; "Agendó en" suele ser Youtube / Referido / Chat. */
  const entry_channel = str(
    pick(f, ['Vía', 'Via', 'Vía', 'Canal entrada', 'Entry channel', 'Canal de entrada', 'Canal'], mappedKeys),
    '',
  ) || null
  const entry_funnel = str(
    pick(f, [
      'Ingreso embudo',
      'Embudo',
      'Funnel',
      'Agendó en',
      'Agendo en',
      'Agendo',
      'Donde agendo',
      'Medio agendamiento',
    ], mappedKeys),
    '',
  ) || null
  let agenda_point = str(
    pick(f, ['Pto agenda', 'Punto de agenda', 'Agenda point', 'Punto Agenda', 'Punto de age'], mappedKeys),
    '',
  ) || null
  if (!agenda_point) {
    agenda_point =
      str(pickContainsAll(f, ['punto', 'agenda'], mappedKeys), '')
      || str(pickStartsWith(f, 'punto de', mappedKeys), '')
      || null
  }

  const setter = str(pick(f, ['Setter', 'Setter asignado', 'SDR'], mappedKeys), '') || null
  const closer = str(pick(f, ['Closer', 'Closer asignado', 'Account executive'], mappedKeys), '') || null

  const program_offered = str(
    pick(f, ['Prog. ofrecido', 'Programa ofrecido', 'Program offered', 'Oferta', 'Producto ofrecido'], mappedKeys),
    '',
  ) || null
  const program_purchased = str(
    pick(f, ['Prog. comprado', 'Programa comprado', 'Program purchased', 'Compró', 'Producto comprado'], mappedKeys),
    '',
  ) || null

  const payment = num(
    pick(f, ['Pagó', 'Pago', 'Payment', 'Paid', 'Monto pagado', 'Pagado', 'Paid amount'], mappedKeys),
  )
  const owed = num(pick(f, ['Debe', 'Owed', 'Balance', 'Saldo', 'Pendiente de pago'], mappedKeys))
  const revenue = num(
    pick(f, ['Facturación', 'Revenue', 'Ingresos', 'Total', 'Monto total', 'Ticket', 'CC', 'Cash collected'], mappedKeys),
  )
  const pago_en_llamada = num(pick(f, ['Pago en llamada', 'Pago llamada'], mappedKeys))
  const ingresos_mensuales = num(pick(f, ['Ingresos lead', 'Ingresos mensuales lead', 'Ingresos mensuales'], mappedKeys))

  const notesMain = str(pick(f, ['Notas', 'Notes', 'Observaciones'], mappedKeys), '') || null

  const first_contact_at = str(
    pick(f, [
      '1er contacto',
      'Primer contacto',
      'First contact',
      'Fecha primer contacto',
      'Inicio conversación',
    ], mappedKeys),
    '',
  ) || null
  let scheduled_at = str(
    pick(f, [
      'Fecha agenda',
      'Fecha agendada',
      'Agendado el',
      'Scheduled',
      'Agendó (fecha)',
      'Fecha de agenda',
    ], mappedKeys),
    '',
  ) || null
  /** Si "Agendó" es solo texto (Youtube) y no fecha, no pisar scheduled_at. */
  const scheduledMaybeText = pick(f, ['Agendó', 'Agendo'], mappedKeys)
  if (!scheduled_at && scheduledMaybeText != null) {
    const s = str(scheduledMaybeText, '')
    if (/^\d{4}-\d{2}-\d{2}/.test(s) || /^\d{1,2}\/\d{1,2}/.test(s)) {
      scheduled_at = s || null
    }
  }
  const call_at = str(
    pick(f, ['Call', 'Llamada', 'Fecha call', 'Fecha llamada', 'Día llamada', 'Show'], mappedKeys),
    '',
  ) || null
  const call_link = str(
    pick(f, ['Link llamada', 'Call link', 'Zoom', 'Meet', 'URL llamada', 'Link meet'], mappedKeys),
    '',
  ) || null

  const closer_report = str(pick(f, ['Reporte closer', 'Reporte', 'Resumen llamada'], mappedKeys), '') || null
  const dolores_setting = str(pick(f, ['Dolores setting', 'Dolores (setting)'], mappedKeys), '') || null
  const dolores_setting_detail = str(pick(f, ['Detalle dolores', 'Detalle dolores setting'], mappedKeys), '') || null
  const dolores_llamada = str(pick(f, ['Dolores llamada', 'Dolores (llamada)'], mappedKeys), '') || null
  const razon_compra = str(pick(f, ['Razón compra', 'Razon compra', 'Por qué compra'], mappedKeys), '') || null

  const compromiso = str(pick(f, ['Compromiso'], mappedKeys), '') || null
  const urgencia = str(pick(f, ['Urgencia'], mappedKeys), '') || null
  const disposicion_invertir = str(pick(f, ['Disp. invertir', 'Disposición a invertir', 'Disposicion a invertir'], mappedKeys), '') || null

  const ctas = num(pick(f, ['CTAs resp.', 'CTAs', 'Ctas respondidas'], mappedKeys))
  const diasRaw = num(pick(f, ['Días agendamiento', 'Dias agendamiento'], mappedKeys))
  const dias_agendamiento = diasRaw || null

  const dateStr =
    str(pick(f, ['Fecha', 'Date', 'Día'], mappedKeys), '') ||
    (rec.createdTime ? rec.createdTime.slice(0, 10) : new Date().toISOString().slice(0, 10))

  const monthField =
    monthFromValue(pick(f, ['Mes', 'Month', 'Mes campaña', 'Campaña', 'Periodo'], mappedKeys))
    || monthFromValue(dateStr)
    || null

  const extraLines: string[] = []
  for (const k of Object.keys(f)) {
    if (mappedKeys.has(k)) continue
    const val = scalar(f[k])
    if (val != null && String(val).trim() !== '') {
      extraLines.push(`${k}: ${val}`)
    }
  }

  const notes =
    [notesMain, extraLines.length ? `— Airtable —\n${extraLines.join('\n')}` : null].filter(Boolean).join('\n\n') ||
    (extraLines.length ? `— Airtable —\n${extraLines.join('\n')}` : null)

  return {
    id: rec.id,
    client_name,
    ig_handle,
    phone,
    avatar_type,
    status: canonicalLeadStatus(status || 'Pendiente'),
    origin,
    entry_channel,
    entry_funnel,
    agenda_point,
    ctas_responded: ctas,
    first_contact_at,
    scheduled_at,
    call_at,
    call_link,
    closer_report,
    program_offered,
    program_purchased,
    revenue,
    payment,
    owed,
    closer,
    setter,
    notes,
    date: dateStr,
    month: monthField,
    email,
    dolores_setting,
    dolores_setting_detail,
    dolores_llamada,
    razon_compra,
    pago_en_llamada,
    dias_agendamiento,
    ingresos_mensuales,
    compromiso,
    urgencia,
    disposicion_invertir,
    calendly_event_uri: str(
      pick(f, ['calendly_event_uri', 'Calendly event uri', 'Calendly event', 'Event URI'], mappedKeys),
      '',
    ) || null,
    calendly_invitee_uri: str(
      pick(f, ['calendly_invitee_uri', 'Calendly invitee uri', 'Calendly invitee'], mappedKeys),
      '',
    ) || null,
    source_type: 'airtable',
  }
}
