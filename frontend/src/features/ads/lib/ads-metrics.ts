/**
 * Métricas de Ads alineadas al módulo de Ads (Skool ATV, 07_ads).
 *
 * Decisiones de fondo:
 * - El modelo es reel → sigue → historias → DM → nutrición → agenda → venta.
 *   Meta solo ve hasta el click al perfil; todo lo que importa pasa en el CRM.
 * - Por eso la "conversión" real no sale de Meta sino de `Lead.vino_de_ads`.
 * - La métrica operativa del módulo es la FRECUENCIA (máx 1,4; a 1,6 el creativo
 *   está quemado) porque es la única con umbral y acción asociada.
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UMBRALES DEL MÓDULO
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Techo operativo: por encima de esto hay que preparar el reemplazo creativo. */
export const FREQ_ALERTA = 1.4
/** El creativo ya se quemó: Meta pierde el aprendizaje y sale a buscar mercado barato. */
export const FREQ_QUEMADA = 1.6
/** Tope de la escala del medidor de frecuencia. */
export const FREQ_ESCALA_MAX = 2.4

/** CPA de agenda calificada objetivo (KPI ATV: < $50). */
export const CPA_AGENDA_OBJETIVO = 50
/** Show up rate objetivo (KPI ATV: > 65%). */
export const SHOW_UP_OBJETIVO = 65
/** Close rate del equipo objetivo (KPI ATV: > 25%). */
export const CLOSE_RATE_OBJETIVO = 25

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TIPOS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type AdsCampaignRow = {
  id: number
  campaign_id: string
  nombre: string
  estado: string
  objective?: string
  thumbnail_url?: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  cost_per_conversion: number
  reach: number
  roas: number | null
}

export type AdsCampaignsResponse = {
  campaigns?: AdsCampaignRow[]
  ads_revenue?: number
  total_spend?: number
  roas?: number | null
  last_sync_at?: string | null
  detail?: unknown
}

/** Salud creativa derivada de la frecuencia. */
export type SaludCreativa = 'sana' | 'alerta' | 'quemada' | 'sin-datos'

/**
 * Etapas del framework de 4 etapas (02_estrategia_de_anuncios), más 'conversion'
 * para las campañas con objetivo de Ventas / Clientes potenciales: esas corren un
 * modelo distinto (pixel + landing) y no se leen con las mismas métricas.
 */
export type EtapaId =
  | 'follow'
  | 'dm-tofu'
  | 'dm-bofu'
  | 'lanzamiento'
  | 'conversion'
  | 'sin-clasificar'

export type EtapaDef = {
  id: EtapaId
  numero: string
  nombre: string
  /** Etiqueta corta para la fila de la tabla. */
  chip: string
  descripcion: string
}

export const ETAPAS: EtapaDef[] = [
  {
    id: 'follow',
    numero: '1',
    nombre: 'Follow Me Ads',
    chip: 'E1 · Follow',
    descripcion: 'Tráfico nuevo con audiencia personalizada. Genera audiencia reprimida.',
  },
  {
    id: 'dm-tofu',
    numero: '2',
    nombre: 'Retargeting DM · TOFU',
    chip: 'E2 · DM TOFU',
    descripcion: 'Historias de atracción a seguidores e interacción 90d. Abre conversaciones.',
  },
  {
    id: 'dm-bofu',
    numero: '3',
    nombre: 'Retargeting DM · BOFU',
    chip: 'E3 · DM BOFU',
    descripcion: 'Casos de éxito a audiencia caliente. Acelera la conversión.',
  },
  {
    id: 'lanzamiento',
    numero: '4',
    nombre: 'Micro-lanzamiento',
    chip: 'E4 · Lanzamiento',
    descripcion: 'Última semana del mes, urgencia real. Amplifica el alcance de historias.',
  },
  {
    id: 'conversion',
    numero: '—',
    nombre: 'Fuera del framework DM',
    chip: 'Pixel / landing',
    descripcion:
      'Objetivo de Ventas o Clientes potenciales: corre con pixel y landing, no con DM. Acá las conversiones de Meta sí valen.',
  },
  {
    id: 'sin-clasificar',
    numero: '—',
    nombre: 'Sin clasificar',
    chip: 'sin etapa',
    descripcion: 'No se pudo inferir la etapa desde el nombre de la campaña.',
  },
]

export const ETAPA_POR_ID: Record<EtapaId, EtapaDef> = ETAPAS.reduce(
  (acc, e) => ({ ...acc, [e.id]: e }),
  {} as Record<EtapaId, EtapaDef>,
)

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FRECUENCIA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Frecuencia = impresiones / alcance. Es exactamente la definición de Meta,
 * así que no hace falta pedirle el campo `frequency` a la API.
 * Devuelve null cuando no hay alcance (campañas viejas sin el dato, o sin entrega).
 */
export function calcFrecuencia(impressions: number, reach: number): number | null {
  const imp = Number(impressions) || 0
  const rch = Number(reach) || 0
  if (rch <= 0 || imp <= 0) return null
  return imp / rch
}

export function saludDeFrecuencia(freq: number | null): SaludCreativa {
  if (freq == null || !Number.isFinite(freq)) return 'sin-datos'
  if (freq >= FREQ_QUEMADA) return 'quemada'
  if (freq >= FREQ_ALERTA) return 'alerta'
  return 'sana'
}

export const SALUD_LABEL: Record<SaludCreativa, string> = {
  sana: 'Sana',
  alerta: 'Alerta',
  quemada: 'Quemada',
  'sin-datos': 'Sin datos',
}

/** Qué hacer con esta campaña, según el módulo de escalado (04_como_escalar_ads_meta). */
export const SALUD_ACCION: Record<SaludCreativa, string> = {
  sana: 'Escalar horizontal',
  alerta: 'Preparar reemplazo',
  quemada: 'Renovar creativo',
  'sin-datos': '—',
}

export const SALUD_ACCION_DETALLE: Record<SaludCreativa, string> = {
  sana: 'Frecuencia por debajo de 1,4. Si viene trayendo leads calificados, duplicá la campaña con el doble de presupuesto en un conjunto nuevo — nunca sumes presupuesto a este.',
  alerta: 'Frecuencia entre 1,4 y 1,6. Tenés días, no semanas: dejá listo el creativo de reemplazo antes de que llegue a 1,6.',
  quemada: 'Frecuencia en 1,6 o más. El creativo está quemado: Meta pierde el aprendizaje y sale a buscar un mercado más barato (leads descalificados). Renovalo ya.',
  'sin-datos': 'Sin alcance registrado en el período. Sincronizá de nuevo o verificá que la campaña haya tenido entrega.',
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ETAPA (inferida del nombre de campaña)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Objetivos donde la conversión la mide el pixel, no el DM. */
const OBJETIVOS_DE_CONVERSION = new Set([
  'OUTCOME_SALES',
  'OUTCOME_LEADS',
  'CONVERSIONS',
  'LEAD_GENERATION',
  'PRODUCT_CATALOG_SALES',
])

export function esObjetivoDeConversion(objective: string | undefined): boolean {
  return OBJETIVOS_DE_CONVERSION.has((objective || '').trim().toUpperCase())
}

const RE_LANZAMIENTO = /(micro[\s-]?lanzamiento|lanzamiento|launch|urgencia|cupos)/i
const RE_BOFU = /(bofu|caso[s]?\s*de\s*[eé]xito|casos?\s*exito|testimonio)/i
const RE_TOFU_DM = /(tofu|\bdm\b|mensaje|direct|chat|retarget|remarketing|nutrici[oó]n|historia)/i
const RE_FOLLOW =
  /(follow[\s-]?me|\bfollow\b|\bfm[\s-]?ads?\b|\bfma\b|seguir|seguidores|visitas?\s*al\s*perfil|tr[aá]fico\s*nuevo|fr[ií]o)/i

/**
 * Infiere la etapa del framework. El objetivo manda sobre el nombre: si la campaña
 * es de Ventas / Clientes potenciales corre otro modelo, sin importar cómo se llame.
 * Para el resto el nombre es la única señal, porque las 4 etapas comparten objetivo
 * ("Tráfico") — por eso es heurístico y existe el bucket "sin clasificar".
 */
export function inferirEtapa(nombre: string, objective?: string): EtapaId {
  if (esObjetivoDeConversion(objective)) return 'conversion'
  const n = (nombre || '').trim()
  if (!n) return 'sin-clasificar'
  if (RE_LANZAMIENTO.test(n)) return 'lanzamiento'
  if (RE_BOFU.test(n)) return 'dm-bofu'
  if (RE_TOFU_DM.test(n)) return 'dm-tofu'
  if (RE_FOLLOW.test(n)) return 'follow'
  return 'sin-clasificar'
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CAMPAÑA ENRIQUECIDA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type CampanaEnriquecida = AdsCampaignRow & {
  frecuencia: number | null
  salud: SaludCreativa
  etapa: EtapaId
  /** true = las conversiones son leads de pixel; false = son conversaciones de DM. */
  objetivoDeConversion: boolean
  cpc: number
  cpm: number
  ctr: number
  activa: boolean
}

export function enriquecerCampana(r: AdsCampaignRow): CampanaEnriquecida {
  const spend = Number(r.spend) || 0
  const impressions = Number(r.impressions) || 0
  const clicks = Number(r.clicks) || 0
  const reach = Number(r.reach) || 0
  const frecuencia = calcFrecuencia(impressions, reach)
  return {
    ...r,
    frecuencia,
    salud: saludDeFrecuencia(frecuencia),
    etapa: inferirEtapa(r.nombre, r.objective),
    objetivoDeConversion: esObjetivoDeConversion(r.objective),
    cpc: clicks > 0 ? spend / clicks : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    activa: (r.estado || '').toUpperCase() === 'ACTIVE',
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EMBUDO ADS (Meta + CRM)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type EmbudoAds = {
  gasto: number
  alcance: number
  impresiones: number
  clicks: number
  /** Frecuencia ponderada del conjunto. Aproximada: el alcance no es deduplicable entre campañas. */
  frecuenciaPonderada: number | null
  /** Conversaciones de DM que reporta Meta (solo campañas del modelo DM, sin las de pixel). */
  chatsMeta: number
  /** Chats efectivamente usados en el embudo, vengan del CRM o de Meta. */
  chats: number
  /**
   * De dónde salió `chats`. 'crm' cuando el CRM tiene leads de ads previos a la agenda;
   * 'meta' cuando no los tiene y se cae a las conversaciones que reporta Meta;
   * 'no-medido' cuando ninguna de las dos fuentes tiene el dato.
   */
  fuenteChats: 'crm' | 'meta' | 'no-medido'
  agendas: number
  shows: number
  noShows: number
  /** Leads que cobraron algo (payment > 0). Es la venta real. */
  ventas: number
  /** Leads con status "Cerrado". Puede diferir de `ventas` si el status quedó sin actualizar. */
  cierresStatus: number
  cash: number
  // Costos unitarios
  costoPorClick: number
  costoPorChat: number
  costoPorAgenda: number
  costoPorShow: number
  costoPorVenta: number
  ticketPromedio: number
  roas: number | null
  // Tasas de paso
  tasaChat: number
  tasaAgenda: number
  showUpRate: number
  closeRate: number
}

export type LeadLike = Record<string, unknown>

export function calcEmbudoAds(
  campanas: CampanaEnriquecida[],
  leadsAds: LeadLike[],
  helpers: {
    tieneAgenda: (l: LeadLike) => boolean
    tieneShow: (l: LeadLike) => boolean
    esCierre: (l: LeadLike) => boolean
  },
): EmbudoAds {
  const gasto = campanas.reduce((s, r) => s + (Number(r.spend) || 0), 0)
  const alcance = campanas.reduce((s, r) => s + (Number(r.reach) || 0), 0)
  const impresiones = campanas.reduce((s, r) => s + (Number(r.impressions) || 0), 0)
  const clicks = campanas.reduce((s, r) => s + (Number(r.clicks) || 0), 0)
  // Solo las campañas del modelo DM: en las de pixel, `conversions` son leads de
  // landing, que no son chats y no pertenecen a este embudo.
  const chatsMeta = campanas
    .filter((r) => !r.objetivoDeConversion)
    .reduce((s, r) => s + (Number(r.conversions) || 0), 0)

  const agendas = leadsAds.filter(helpers.tieneAgenda).length
  const shows = leadsAds.filter(helpers.tieneShow).length
  const cierresStatus = leadsAds.filter(helpers.esCierre).length
  const noShows = agendas - shows
  const conPago = leadsAds.filter((l) => (Number(l.payment) || 0) > 0)
  const ventas = conPago.length
  const cash = leadsAds.reduce((s, l) => s + (Number(l.payment) || 0), 0)

  // Si todos los leads marcados como "vino de ads" ya tienen agenda, el CRM no está
  // midiendo el chat: se tildan recién cuando agendan. En ese caso no inventamos un
  // paso duplicando la agenda — se usa lo que reporta Meta, o se declara no medido.
  const chatsCrm = leadsAds.length
  const crmMideChats = chatsCrm > agendas
  const chats = crmMideChats ? chatsCrm : chatsMeta
  const fuenteChats: EmbudoAds['fuenteChats'] = crmMideChats
    ? 'crm'
    : chatsMeta > 0
      ? 'meta'
      : 'no-medido'

  const div = (a: number, b: number) => (b > 0 ? a / b : 0)
  const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0)

  return {
    gasto,
    alcance,
    impresiones,
    clicks,
    frecuenciaPonderada: calcFrecuencia(impresiones, alcance),
    chatsMeta,
    chats,
    fuenteChats,
    agendas,
    shows,
    noShows,
    ventas,
    cierresStatus,
    cash,
    costoPorClick: div(gasto, clicks),
    costoPorChat: div(gasto, chats),
    costoPorAgenda: div(gasto, agendas),
    costoPorShow: div(gasto, shows),
    costoPorVenta: div(gasto, ventas),
    ticketPromedio: div(cash, ventas),
    roas: gasto > 0 ? cash / gasto : null,
    tasaChat: pct(chats, clicks),
    tasaAgenda: pct(agendas, chats),
    showUpRate: pct(shows, agendas),
    closeRate: pct(ventas, shows),
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FORMATO
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function formatUsd(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return '—'
  return `$${n.toLocaleString('es-AR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`
}

export function formatUsdCompacto(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 10_000) return `$${Math.round(n).toLocaleString('es-AR')}`
  return formatUsd(n)
}

export function formatFrecuencia(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatRoas(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`
}

export function formatPct(n: number, decimals = 1): string {
  if (!Number.isFinite(n)) return '—'
  return `${n.toLocaleString('es-AR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}%`
}

export function formatEstado(raw: string): string {
  const s = (raw || '').trim()
  if (!s) return '—'
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase().replace(/_/g, ' ')
}

const OBJECTIVE_LABELS: Record<string, string> = {
  OUTCOME_AWARENESS: 'Reconocimiento',
  OUTCOME_ENGAGEMENT: 'Engagement',
  OUTCOME_LEADS: 'Leads',
  OUTCOME_SALES: 'Ventas',
  OUTCOME_TRAFFIC: 'Tráfico',
  OUTCOME_APP_PROMOTION: 'App',
  LINK_CLICKS: 'Clicks al link',
  POST_ENGAGEMENT: 'Engagement',
  PAGE_LIKES: 'Me gusta',
  LEAD_GENERATION: 'Leads',
  CONVERSIONS: 'Conversiones',
  PRODUCT_CATALOG_SALES: 'Catálogo',
  REACH: 'Alcance',
  BRAND_AWARENESS: 'Marca',
  VIDEO_VIEWS: 'Video',
  MESSAGES: 'Mensajes',
}

export function formatObjective(raw: string | undefined): string {
  const s = (raw || '').trim()
  if (!s) return ''
  return OBJECTIVE_LABELS[s] || s.replace(/^OUTCOME_/, '').replace(/_/g, ' ').toLowerCase()
}
