'use client'

import { useState, useEffect, useCallback } from 'react'
import { useToast } from '@/shared/components/toast'
import { useSupabase } from '@/shared/hooks/use-supabase'

type Connection = {
  id?: string
  platform: string
  credentials: Record<string, string>
  last_sync_at: string | null
}

type PlatformDef = {
  key: string
  label: string
  icon: string
  subtitle: string
  fields: { key: string; label: string; placeholder?: string; type?: string; span?: 2 }[]
  guide: { title: string; steps: string[] }
}

const PLATFORMS: PlatformDef[] = [
  {
    key: 'calendly', label: 'Calendly', icon: '📅', subtitle: 'Crea leads automaticamente cuando alguien agenda una sesion',
    fields: [
      { key: 'api_key', label: 'Personal Access Token de Calendly', placeholder: 'eyJraWQ...', type: 'password' },
    ],
    guide: {
      title: 'Como configurar Calendly',
      steps: [
        'Anda a calendly.com → tu avatar → Integraciones → API & Webhooks',
        'Genera un Personal Access Token con permisos de Webhooks + Programacion + Gestion de usuarios',
        'Pegalo en el campo de arriba y dale Conectar',
        'Se genera automaticamente un webhook token y la URL del webhook',
        'Anda a calendly.com/integrations/api_webhooks → Add Webhook',
        'Pega la URL del webhook que aparece abajo',
        'Selecciona los eventos: invitee.created e invitee.canceled',
        'Listo! Cuando alguien agende, el lead se crea automaticamente en tu tablero',
      ],
    },
  },
  {
    key: 'fathom', label: 'Fathom', icon: '🎙️', subtitle: 'Analiza llamadas automaticamente con IA post-llamada del closer',
    fields: [
      { key: 'api_key', label: 'API Key de Fathom', placeholder: 'Tu API Key de fathom.video', type: 'password' },
      { key: 'webhook_secret', label: 'Webhook Secret', placeholder: 'whsec_...', type: 'password' },
    ],
    guide: {
      title: 'Como configurar Fathom',
      steps: [
        'Anda a fathom.video → Settings → API Access',
        'Genera una API Key y un Webhook Secret',
        'Pegá ambos en los campos de arriba y dale Conectar',
        'Se genera automaticamente la URL del webhook',
        'En Fathom, hace click en "Add Webhook" y pega la URL que aparece abajo',
        'Activa los scopes: Summary, Action Items, y Transcript',
        'Listo! Despues de cada llamada, la IA genera el reporte del closer automaticamente',
      ],
    },
  },
  {
    key: 'manychat', label: 'ManyChat', icon: '💬', subtitle: 'Conecta tu keyword de bio para trackear chats automaticamente',
    fields: [
      { key: 'api_key', label: 'API Key de ManyChat', placeholder: 'Tu API Key de Settings → API', type: 'password' },
    ],
    guide: {
      title: 'Como configurar ManyChat',
      steps: [
        'En ManyChat, anda a Settings (engranaje) → API → copia tu API Key y pegala aca',
        'Dale a Conectar — se genera un token y una URL de webhook automaticamente',
        'En ManyChat, anda a Automation → tu flow de keyword de bio',
        'Agrega una accion "External Request" (POST) al final del flow',
        'Pega la URL del webhook que aparece abajo',
        'En el body JSON del request usa: {"webhook_token": "TU_TOKEN", "keyword": "{{last_input_text}}", "contact_name": "{{first_name}}", "contact_ig_username": "{{ig_username}}", "manychat_contact_id": "{{id}}"}',
        'Listo! Los chats se loguean automaticamente y podes ver tus etiquetas desde BIO',
      ],
    },
  },
  {
    key: 'apify', label: 'Apify', icon: '🕷️', subtitle: 'Scrapea reels de Instagram con transcripcion de audio para clasificar',
    fields: [
      { key: 'api_token', label: 'API Token', placeholder: 'apify_api_...', type: 'password' },
      { key: 'ig_handle', label: 'Usuario de Instagram (sin @)', placeholder: 'juanxcarrizo' },
      { key: 'limit', label: 'Limite de reels por sync', placeholder: '10' },
    ],
    guide: {
      title: 'Como configurar Apify',
      steps: [
        'Crea una cuenta en apify.com (tiene $5 USD gratis para empezar)',
        'Anda a console.apify.com → Settings → Integrations',
        'Copia tu "Personal API Token" y pegalo en el campo API Token',
        'En "Usuario de Instagram" pone tu handle sin @ (ej: juanxcarrizo)',
        'El limite define cuantos reels scrapea por sync (~$0.08 por reel con transcript)',
        'Listo! Anda a Reels y apreta "Sincronizar Instagram"',
      ],
    },
  },
  {
    key: 'metricool', label: 'Metricool', icon: '📊', subtitle: 'Importa reels e historias automaticamente desde tu cuenta de Metricool',
    fields: [
      { key: 'user_token', label: 'User Token', placeholder: 'Tu token de API de Metricool', type: 'password' },
      { key: 'user_id', label: 'User ID', placeholder: 'Tu User ID de Metricool' },
      { key: 'blog_id', label: 'Blog ID', placeholder: 'Tu Blog ID de Metricool' },
    ],
    guide: {
      title: 'Como configurar Metricool',
      steps: [
        'Inicia sesion en app.metricool.com',
        'Anda a Ajustes → API (necesitas plan con acceso API)',
        'Copia tu User Token y pegalo aca',
        'El User ID y Blog ID los encontras en la URL de tu dashboard o en la seccion de API',
        'Metricool importa reels + historias con metricas (views, likes, comments, reach)',
        'Listo! Los datos se importan automaticamente al sincronizar',
      ],
    },
  },
  {
    key: 'youtube', label: 'YouTube', icon: '▶️', subtitle: 'Importa videos de tu canal con YouTube Data API',
    fields: [
      { key: 'api_key', label: 'API Key de Google', placeholder: 'AIzaSy...', type: 'password' },
      { key: 'channel_id', label: 'Channel ID', placeholder: 'UCxxxxxxxxxx' },
    ],
    guide: {
      title: 'Como configurar YouTube',
      steps: [
        'Anda a console.cloud.google.com',
        'Crea un proyecto nuevo (o usa uno existente)',
        'Anda a APIs & Services → Library → busca "YouTube Data API v3" → Enable',
        'Anda a APIs & Services → Credentials → Create Credentials → API Key',
        'Copia la API Key y pegala aca',
        'Para tu Channel ID: abri YouTube → tu canal → la URL tiene /channel/UCxxxxxxxxxx',
        'Alternativa: busca "YouTube Channel ID finder" en Google y pega tu URL',
        'Listo! Anda a YouTube y apreta sincronizar',
      ],
    },
  },
  {
    key: 'airtable', label: 'Airtable', icon: '📋', subtitle: 'Sincroniza leads y ventas con tu CRM de Airtable',
    fields: [
      {
        key: 'personal_access_token',
        label: 'Personal Access Token (PAT)',
        placeholder: 'pat... (airtable.com/create/tokens)',
        type: 'password',
        span: 2,
      },
      {
        key: 'base_id',
        label: 'Base ID',
        placeholder: 'app… (ej: appcdWzVfsRY75jj3)',
        span: 2,
      },
      {
        key: 'table_id',
        label: 'Table ID (recomendado)',
        placeholder: 'tbl… de la URL — ej: tblZT83Ja3qxcKW2p',
      },
      { key: 'table_name', label: 'Nombre de la tabla', placeholder: 'Leads Marzo' },
      {
        key: 'view_id',
        label: 'View ID (opcional)',
        placeholder: 'viw… de la URL — misma vista que en Airtable',
        span: 2,
      },
    ],
    guide: {
      title: 'Como configurar Airtable',
      steps: [
        'En airtable.com/create/tokens crea un token con acceso a tu base (scopes: data.records:read como minimo; schema.bases:read para verificar tablas).',
        'Copia el PAT y pegalo arriba (empieza con pat...). No lo compartas ni lo subas a git.',
        'Base ID: en la URL es el tramo que empieza con app — en tu ejemplo: appcdWzVfsRY75jj3 (solo eso, sin https ni barras). También podés pegar la URL completa y lo tomamos automático.',
        'Table ID (recomendado): en la misma URL viene tbl… — en tu ejemplo: tblZT83Ja3qxcKW2p. Así la API no depende del nombre exacto de la pestaña.',
        'Nombre de la tabla: ej. Leads Marzo (se usa si no cargás Table ID; debe coincidir con el nombre de la pestaña).',
        'View ID (opcional): si en Airtable usás una vista filtrada (Leads, etc.), copiá el viw… de la URL para que el listado coincida con lo que ves en el tablero.',
        'Guardá y usá "Probar conexión". Si falla, en el token PAT tenés que dar acceso explícito a la base ATV.',
        'La sync bidireccional con leads se puede disparar desde el dashboard cuando este cableada.',
      ],
    },
  },
]

export default function ConexionesPage() {
  const { toast } = useToast()
  const { ready, userId } = useSupabase()
  const [connections, setConnections] = useState<Record<string, Connection>>({})
  const [loading, setLoading] = useState(true)

  // URL absoluta del API (prod / otro host) o proxy same-origin en dev: ver next.config → /api-backend
  const apiBase =
    (process.env.NEXT_PUBLIC_BACKEND_URL || '').trim().replace(/\/$/, '') || '/api-backend'

  const fetchConnections = useCallback(async () => {
    if (!ready) return
    if (!userId) {
      setConnections({})
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${apiBase}/conexiones`, {
        headers: { 'X-User-Id': userId },
      })
      const raw = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail = typeof raw === 'object' && raw && 'detail' in raw
          ? String((raw as { detail: unknown }).detail)
          : res.statusText
        toast(`Error al cargar conexiones: ${detail}`)
        setLoading(false)
        return
      }
      const rows = raw as Array<{
        id: string
        platform: string
        credentials: Record<string, string>
        last_sync_at: string | null
      }>
      const map: Record<string, Connection> = {}
      rows.forEach((row) => {
        const creds = row.credentials || {}
        const asStrings: Record<string, string> = {}
        Object.entries(creds).forEach(([k, v]) => { asStrings[k] = v == null ? '' : String(v) })
        map[row.platform] = {
          id: row.id,
          platform: row.platform,
          credentials: asStrings,
          last_sync_at: row.last_sync_at,
        }
      })
      setConnections(map)
    } finally {
      setLoading(false)
    }
  }, [ready, userId, apiBase, toast])

  useEffect(() => { fetchConnections() }, [fetchConnections])

  const saveConnection = async (platform: string, credentials: Record<string, string>) => {
    if (!userId) { toast('Error: no hay sesion activa'); return }
    const webhookPlatforms = ['manychat', 'calendly', 'fathom']
    if (webhookPlatforms.includes(platform) && !credentials.webhook_token) {
      credentials.webhook_token = crypto.randomUUID().replace(/-/g, '')
    }
    const res = await fetch(`${apiBase}/conexiones/${encodeURIComponent(platform)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': userId,
      },
      body: JSON.stringify({ credentials }),
    })
    const raw = await res.json().catch(() => ({}))
    if (!res.ok) {
      const detail = typeof raw === 'object' && raw && 'detail' in raw
        ? String((raw as { detail: unknown }).detail)
        : res.statusText
      toast(`Error: ${detail}`)
      return
    }
    toast(`${platform} guardado ✓`)
    fetchConnections()
  }

  if (loading) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold tracking-tight">Conexiones API</h2>
        <p className="mt-1 text-[12px] text-[var(--text3)]">Conecta tus cuentas de Instagram (via Metricool) y YouTube para importar contenido automaticamente. Las credenciales se guardan de forma segura en tu cuenta.</p>
      </div>

      <div className="space-y-4">
        {PLATFORMS.map((p) => {
          const conn = connections[p.key]
          const isConnected = conn && Object.values(conn.credentials).some(v => v)
          return (
            <ConnectionCard
              key={p.key}
              platform={p}
              connection={conn}
              isConnected={!!isConnected}
              onSave={(creds) => saveConnection(p.key, creds)}
              userId={userId || ''}
              apiBase={apiBase}
            />
          )
        })}
      </div>
    </div>
  )
}

function ConnectionCard({
  platform,
  connection,
  isConnected,
  onSave,
  userId,
  apiBase,
}: {
  platform: PlatformDef
  connection?: Connection
  isConnected: boolean
  onSave: (creds: Record<string, string>) => void
  userId: string
  apiBase: string
}) {
  const [form, setForm] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [airtableVerifyLoading, setAirtableVerifyLoading] = useState(false)
  const [airtableVerifyMsg, setAirtableVerifyMsg] = useState<string | null>(null)

  useEffect(() => {
    if (connection?.credentials) setForm(connection.credentials)
  }, [connection])

  return (
    <div className="glass-card p-5">
      {/* Header */}
      <div className="flex items-center gap-4 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--bg4)] text-lg">{platform.icon}</div>
        <div className="flex-1">
          <div className="text-[14px] font-semibold">{platform.label}</div>
          <div className="text-[12px] text-[var(--text3)]">{platform.subtitle}</div>
        </div>
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${isConnected ? 'bg-[var(--green)] shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-[var(--text3)]'}`} />
          <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text3)]">
            {isConnected ? 'Conectado' : 'Desconectado'}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-[var(--border)]">
          {/* Guide toggle */}
          <button
            onClick={() => setShowGuide(!showGuide)}
            className="mb-4 flex items-center gap-2 rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-2.5 text-[12px] text-[var(--text2)] transition-all hover:border-[var(--accent)] hover:text-[var(--accent)] w-full text-left"
          >
            <span className="text-[14px]">{showGuide ? '▾' : '▸'}</span>
            <span className="font-medium">Como configurar {platform.label} — paso a paso</span>
          </button>

          {/* Guide steps */}
          {showGuide && (
            <div className="mb-5 rounded-lg bg-[var(--bg3)] border border-[var(--border)] p-5">
              <h4 className="text-[12px] font-semibold text-[var(--accent)] mb-3">{platform.guide.title}</h4>
              <ol className="space-y-2.5">
                {platform.guide.steps.map((step, i) => (
                  <li key={i} className="flex gap-3 text-[12px] text-[var(--text2)] leading-relaxed">
                    <span className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-[var(--accent)] text-white text-[10px] font-bold mt-0.5">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Fields (non-ManyChat platforms) */}
          {platform.fields.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {platform.fields.map((f) => (
                <div key={f.key} className={f.span === 2 ? 'col-span-2' : undefined}>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">{f.label}</label>
                  <input
                    type={f.type || 'text'}
                    value={form[f.key] || ''}
                    onChange={(e) => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)] placeholder:text-[var(--text3)] placeholder:opacity-50"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Save / Connect button */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {['manychat', 'calendly', 'fathom'].includes(platform.key) && !isConnected ? (
              <button
                onClick={() => onSave({ ...form, webhook_token: crypto.randomUUID().replace(/-/g, '') })}
                className="rounded-lg bg-[var(--accent)] px-5 py-2 text-[11px] font-semibold uppercase text-white hover:opacity-90"
              >
                Conectar {platform.label}
              </button>
            ) : (
              <button
                onClick={() => onSave(form)}
                className="rounded-lg bg-[var(--accent)] px-5 py-2 text-[11px] font-semibold uppercase text-white hover:opacity-90"
              >
                Guardar
              </button>
            )}
            {platform.key === 'airtable' && userId && (
              <button
                type="button"
                disabled={airtableVerifyLoading}
                onClick={async () => {
                  setAirtableVerifyMsg(null)
                  setAirtableVerifyLoading(true)
                  try {
                    const res = await fetch(`${apiBase}/airtable/verify`, {
                      headers: { 'X-User-Id': userId },
                    })
                    const raw = await res.text()
                    const data = (() => {
                      try { return raw ? JSON.parse(raw) : {} } catch { return { detail: raw } }
                    })() as { ok?: boolean; message?: string; detail?: string }
                    if (!res.ok) {
                      setAirtableVerifyMsg(`Error: ${data.detail || data.message || res.statusText}`)
                    } else {
                      setAirtableVerifyMsg(data.message || (data.ok ? 'OK' : 'Revisá la respuesta'))
                    }
                  } catch (e) {
                    setAirtableVerifyMsg(`Error: ${(e as Error).message}`)
                  } finally {
                    setAirtableVerifyLoading(false)
                  }
                }}
                className="rounded-lg border border-[var(--border2)] px-4 py-2 text-[11px] font-semibold uppercase text-[var(--text2)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40"
              >
                {airtableVerifyLoading ? 'Probando...' : 'Probar conexión'}
              </button>
            )}
            {connection?.last_sync_at && (
              <span className="text-[11px] text-[var(--text3)]">
                Ultima sync: {new Date(connection.last_sync_at).toLocaleString('es-AR')}
              </span>
            )}
            {platform.key === 'airtable' && airtableVerifyMsg && (
              <span className={`text-[11px] ${airtableVerifyMsg.startsWith('Error') ? 'text-[var(--red)]' : 'text-[var(--green)]'}`}>
                {airtableVerifyMsg}
              </span>
            )}
          </div>

          {/* Webhook URL display for platforms with webhooks */}
          {['manychat', 'calendly', 'fathom'].includes(platform.key) && connection?.credentials?.webhook_token && (
            <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg3)] p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)] mb-2">URL del Webhook (pegar en {platform.label})</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-[var(--bg4)] px-3 py-2 text-[12px] text-[var(--accent)] break-all select-all">
                  {typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/{platform.key}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/api/webhooks/${platform.key}`)
                  }}
                  className="rounded-lg border border-[var(--border2)] px-3 py-2 text-[11px] text-[var(--text2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  Copiar
                </button>
              </div>
              <div className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)] mb-1">Token</div>
              <code className="block rounded bg-[var(--bg4)] px-3 py-2 text-[12px] text-[var(--text2)] break-all select-all">
                {connection.credentials.webhook_token}
              </code>
              <p className="mt-2 text-[11px] text-[var(--text3)]">
                {platform.key === 'manychat' && 'Incluí este token en el body del External Request de ManyChat como "webhook_token".'}
                {platform.key === 'calendly' && 'Configurá este webhook en Calendly con los eventos invitee.created e invitee.canceled.'}
                {platform.key === 'fathom' && 'Agregá este webhook en Fathom con los scopes: Summary, Action Items, y Transcript.'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
