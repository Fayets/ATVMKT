'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { apiFetch, backendAuthHeaders, formatApiDetail } from '@/lib/api'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { useToast } from '@/shared/components/toast'
import { formatIsoDateDdMmYyyy } from '@/shared/lib/format-utils'
import {
  createManualCall,
  generateCloserReportsForDay,
  getDailyCalls,
  getPendingAgendaLeads,
  getProgramOptions,
  getTeamMemberNames,
  patchLeadSetter,
  patchLeadAgendaPoint,
  patchLeadCalificacion,
  patchLeadCallLink,
  patchLeadCloser,
  patchLeadOwed,
  patchLeadPayment,
  patchLeadProgramOffered,
  patchLeadProgramadaOfrecido,
  patchLeadStatus,
  patchLeadVinoDeAds,
  resolveDefaultCloser,
  buildCloserOptions,
} from '../services/daily-panel-service'
import {
  createAdminManualCall,
  getAdminDailyCalls,
} from '@/features/admin-panel/services/admin-panel-service'
import { DEFAULT_DAILY_CLOSER } from '../constants'
import type { DailyCall, PendingAgendaLead } from '../types'
import { DailyCallsTable } from './daily-calls-table'
import { PendingAgendaTable } from './pending-agenda-table'
import { AgendaPointPickerModal } from '@/features/leads/components/agenda-point-picker-modal'
import '../daily-panel.css'
import '../daily-panel-manual-call.css'

const AR_TZ = 'America/Argentina/Buenos_Aires'

function todayIsoArgentina(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: AR_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function useArgentinaClock(active: boolean): string {
  const [clock, setClock] = useState('')

  useEffect(() => {
    if (!active) {
      setClock('')
      return undefined
    }
    const tick = () => {
      setClock(
        new Intl.DateTimeFormat('es-AR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
          timeZone: AR_TZ,
        }).format(new Date()),
      )
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [active])

  return clock
}

function monthKeyFromIsoDate(isoDate: string): string {
  return isoDate.slice(0, 7)
}

function monthLabelFromKey(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number)
  if (!y || !m) return monthKey
  const label = new Intl.DateTimeFormat('es-AR', { month: 'long' }).format(new Date(y, m - 1, 1))
  return `${label} ${y}`
}

function PanelShell({ children }: { children: ReactNode }) {
  return (
    <div className="neo-panel">
      <div className="neo-panel__backdrop" aria-hidden="true" />
      <div className="neo-panel__inner">{children}</div>
    </div>
  )
}

export function DailyPanelPage({
  mode = 'default',
  adminToken = null,
}: {
  mode?: 'default' | 'admin'
  adminToken?: string | null
}) {
  const isAdmin = mode === 'admin' && Boolean(adminToken)
  const { ready, userId } = useAuthUser()
  const { toast } = useToast()
  const [selectedDate, setSelectedDate] = useState(todayIsoArgentina)
  const [calls, setCalls] = useState<DailyCall[]>([])
  const [pendingAgenda, setPendingAgenda] = useState<PendingAgendaLead[]>([])
  const [pendingAgendaMonth, setPendingAgendaMonth] = useState('')
  const [pendingLoading, setPendingLoading] = useState(true)
  const [agendaModalLead, setAgendaModalLead] = useState<PendingAgendaLead | null>(null)
  const [closerOptions, setCloserOptions] = useState<string[]>([])
  const [setterOptions, setSetterOptions] = useState<string[]>([])
  const [programOptions, setProgramOptions] = useState<string[]>([''])
  const [defaultCloser, setDefaultCloser] = useState(DEFAULT_DAILY_CLOSER)
  const [loading, setLoading] = useState(true)
  const [manualOpen, setManualOpen] = useState(false)
  const [manualName, setManualName] = useState('')
  const [manualHora, setManualHora] = useState('')
  const [manualCloser, setManualCloser] = useState('')
  const [manualSaving, setManualSaving] = useState(false)
  const [generatingReport, setGeneratingReport] = useState(false)
  const [downloadingBackup, setDownloadingBackup] = useState(false)
  const clock = useArgentinaClock(ready && Boolean(userId))
  const operativeMonth = monthKeyFromIsoDate(selectedDate)

  const fetchCalls = useCallback(
    async (silent = false) => {
      if (!ready || !userId) {
        setCalls([])
        setPendingAgenda([])
        setPendingAgendaMonth('')
        setLoading(false)
        setPendingLoading(false)
        return
      }
      if (isAdmin && !adminToken) {
        setLoading(false)
        setPendingLoading(false)
        return
      }
      if (!silent) {
        setLoading(true)
        setPendingLoading(true)
      }
      try {
        let closers: string[] = []
        let setters: string[] = []
        try {
          const team = await getTeamMemberNames()
          closers = team.closers
          setters = team.setters
        } catch {
          closers = []
          setters = []
        }
        setSetterOptions(setters)
        const resolvedDefault = resolveDefaultCloser(closers)
        setCloserOptions(closers)
        setDefaultCloser(resolvedDefault)
        setManualCloser((prev) => prev || resolvedDefault)
        void getProgramOptions()
          .then(setProgramOptions)
          .catch(() => setProgramOptions(['']))

        const monthKey = monthKeyFromIsoDate(selectedDate)
        const [callsData, pendingData] = await Promise.all([
          isAdmin
            ? getAdminDailyCalls(selectedDate, adminToken!, closers, resolvedDefault)
            : getDailyCalls(selectedDate, closers, resolvedDefault),
          getPendingAgendaLeads(monthKey),
        ])
        setCalls(callsData.llamadas)
        setPendingAgenda(pendingData.leads)
        setPendingAgendaMonth(pendingData.month || monthKey)
      } catch (e) {
        if (!silent) {
          toast(e instanceof Error ? e.message : 'Error al cargar el panel.')
        }
      } finally {
        if (!silent) {
          setLoading(false)
          setPendingLoading(false)
        }
      }
    },
    [ready, userId, toast, isAdmin, adminToken, selectedDate],
  )

  useEffect(() => {
    void fetchCalls()
  }, [fetchCalls])

  const handleStatusChange = useCallback(
    async (leadId: number, status: string) => {
      try {
        await patchLeadStatus(leadId, status)
        setCalls((prev) =>
          prev.map((c) => (c.id === leadId ? { ...c, status } : c)),
        )
      } catch (e) {
        toast(e instanceof Error ? e.message : 'No se pudo guardar el status.')
        throw e
      }
    },
    [toast],
  )

  const handleCloserChange = useCallback(
    async (leadId: number, closer: string) => {
      try {
        await patchLeadCloser(leadId, closer)
        setCalls((prev) =>
          prev.map((c) => (c.id === leadId ? { ...c, closer } : c)),
        )
      } catch (e) {
        toast(e instanceof Error ? e.message : 'No se pudo guardar el closer.')
        throw e
      }
    },
    [toast],
  )

  const handleFathomLinkChange = useCallback(
    async (leadId: number, callLink: string | null) => {
      try {
        await patchLeadCallLink(leadId, callLink)
        setCalls((prev) =>
          prev.map((c) => (c.id === leadId ? { ...c, call_link: callLink ?? '' } : c)),
        )
        if (callLink?.trim()) {
          toast('Link guardado. Análisis Fathom en curso si aplica.')
        }
      } catch (e) {
        toast(e instanceof Error ? e.message : 'No se pudo guardar el link.')
        throw e
      }
    },
    [toast],
  )

  const handlePaymentChange = useCallback(
    async (leadId: number, payment: number) => {
      try {
        await patchLeadPayment(leadId, payment)
        setCalls((prev) =>
          prev.map((c) => (c.id === leadId ? { ...c, payment } : c)),
        )
      } catch (e) {
        toast(e instanceof Error ? e.message : 'No se pudo guardar el pago.')
        throw e
      }
    },
    [toast],
  )

  const handleOwedChange = useCallback(
    async (leadId: number, owed: number) => {
      try {
        await patchLeadOwed(leadId, owed)
        setCalls((prev) =>
          prev.map((c) => (c.id === leadId ? { ...c, owed } : c)),
        )
      } catch (e) {
        toast(e instanceof Error ? e.message : 'No se pudo guardar el debe.')
        throw e
      }
    },
    [toast],
  )

  const handleProgramOfferedChange = useCallback(
    async (leadId: number, program: string) => {
      try {
        await patchLeadProgramOffered(leadId, program)
        setCalls((prev) =>
          prev.map((c) => (c.id === leadId ? { ...c, program_offered: program } : c)),
        )
      } catch (e) {
        toast(e instanceof Error ? e.message : 'No se pudo guardar el programa comprado.')
        throw e
      }
    },
    [toast],
  )

  const handleProgramadaOfrecidoChange = useCallback(
    async (leadId: number, program: string) => {
      try {
        await patchLeadProgramadaOfrecido(leadId, program)
        setCalls((prev) =>
          prev.map((c) =>
            c.id === leadId ? { ...c, programada_ofrecido_llamada: program } : c,
          ),
        )
      } catch (e) {
        toast(e instanceof Error ? e.message : 'No se pudo guardar el programa ofrecido.')
        throw e
      }
    },
    [toast],
  )

  const handleCalificacionChange = useCallback(
    async (leadId: number, calificacion: DailyCall['calificacion_llamada']) => {
      try {
        await patchLeadCalificacion(leadId, calificacion)
        setCalls((prev) =>
          prev.map((c) => (c.id === leadId ? { ...c, calificacion_llamada: calificacion } : c)),
        )
      } catch (e) {
        toast(e instanceof Error ? e.message : 'No se pudo guardar la calificación.')
        throw e
      }
    },
    [toast],
  )

  const handleVinoDeAdsChange = useCallback(
    async (leadId: number, vinoDeAds: boolean) => {
      try {
        await patchLeadVinoDeAds(leadId, vinoDeAds)
        setCalls((prev) =>
          prev.map((c) => (c.id === leadId ? { ...c, vino_de_ads: vinoDeAds } : c)),
        )
      } catch (e) {
        toast(e instanceof Error ? e.message : 'No se pudo guardar.')
        throw e
      }
    },
    [toast],
  )

  const handleAssignAgendaPoint = useCallback(
    async (leadId: number, value: string) => {
      try {
        await patchLeadAgendaPoint(leadId, value)
        setPendingAgenda((prev) => prev.filter((l) => l.id !== leadId))
        toast('Punto de agenda guardado.')
      } catch (e) {
        toast(e instanceof Error ? e.message : 'No se pudo guardar el punto de agenda.')
        throw e
      }
    },
    [toast],
  )

  const handleSetterChange = useCallback(
    async (leadId: number, setter: string) => {
      try {
        await patchLeadSetter(leadId, setter)
        setPendingAgenda((prev) =>
          prev.map((l) => (l.id === leadId ? { ...l, setter: setter.trim() || null } : l)),
        )
      } catch (e) {
        toast(e instanceof Error ? e.message : 'No se pudo guardar el setter.')
        throw e
      }
    },
    [toast],
  )

  const handleAddManualCall = useCallback(async () => {
    const name = manualName.trim()
    const hora = manualHora.trim()
    const closer = (manualCloser || defaultCloser).trim()
    if (!name) {
      toast('Indicá el nombre del lead.')
      return
    }
    if (!/^\d{1,2}:\d{2}$/.test(hora)) {
      toast('Hora inválida (usar HH:MM).')
      return
    }
    if (!closer) {
      toast('Seleccioná un closer.')
      return
    }
    setManualSaving(true)
    try {
      if (isAdmin && adminToken) {
        await createAdminManualCall(selectedDate, adminToken, {
          client_name: name,
          closer,
          hora,
        })
      } else {
        await createManualCall({
          client_name: name,
          closer,
          hora,
          fecha: selectedDate,
        })
      }
      toast('Llamada agregada.')
      setManualOpen(false)
      setManualName('')
      setManualHora('')
      await fetchCalls(true)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo agregar la llamada.')
    } finally {
      setManualSaving(false)
    }
  }, [manualName, manualHora, manualCloser, defaultCloser, toast, fetchCalls, isAdmin, adminToken, selectedDate])

  const handleGenerateReport = useCallback(async () => {
    const reportDate = selectedDate
    if (!reportDate) {
      toast('Esperá a que cargue el panel.')
      return
    }
    if (calls.length === 0) {
      toast('No hay llamadas en el panel para generar reportes.')
      return
    }
    setGeneratingReport(true)
    try {
      const result = await generateCloserReportsForDay(reportDate)
      const label =
        result.generated === 1 ? '1 reporte generado' : `${result.generated} reportes generados`
      toast(
        result.discord_sent ? `${label} y enviados a Discord` : `${label} (Discord no configurado)`,
      )
      window.dispatchEvent(new Event('atvmkt-team-reports-changed'))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo generar el reporte del día.')
    } finally {
      setGeneratingReport(false)
    }
  }, [selectedDate, calls.length, toast])

  const downloadFullBackup = useCallback(async () => {
    setDownloadingBackup(true)
    try {
      const res = await apiFetch('/export/full', { headers: backendAuthHeaders() })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { detail?: unknown }
        toast(`No se pudo descargar el backup: ${formatApiDetail(data.detail, res.statusText)}`)
        return
      }
      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') || ''
      const match = /filename=\"?([^\";]+)\"?/i.exec(cd)
      const filename = match?.[1] || `atv-backup-${new Date().toISOString().slice(0, 10)}.json`
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      toast('Backup descargado')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al descargar el backup')
    } finally {
      setDownloadingBackup(false)
    }
  }, [toast])

  if (!ready) {
    return (
      <PanelShell>
        <div className="neo-panel__loading">Cargando…</div>
      </PanelShell>
    )
  }

  if (!userId) {
    return (
      <PanelShell>
        <div className="neo-panel__empty">Iniciá sesión para ver el panel.</div>
      </PanelShell>
    )
  }

  const isToday = selectedDate === todayIsoArgentina()
  const fechaLabel = isToday ? 'HOY' : formatIsoDateDdMmYyyy(selectedDate)
  const countLabel =
    calls.length === 1 ? '1 llamada' : `${calls.length} llamadas`
  const pendingCountLabel =
    pendingAgenda.length === 1 ? '1 pendiente' : `${pendingAgenda.length} pendientes`
  const pendingMonthLabel = monthLabelFromKey(pendingAgendaMonth || operativeMonth)

  return (
    <PanelShell>
      <header className="neo-panel__header">
        <div>
          <h1 className="neo-panel__title">
            {isAdmin ? 'Corrección reportes' : 'Dashboard diario'}
          </h1>
          <p className="neo-panel__subtitle">
            {fechaLabel} · Argentina
            {isAdmin ? ' · modo admin' : ''}
          </p>
        </div>
        <div className="neo-panel__header-meta">
          <label className="neo-panel__date-field">
            <span className="sr-only">Fecha</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="neo-panel__date-input"
            />
          </label>
          {clock ? <span className="neo-panel__clock">{clock}</span> : null}
          <button
            type="button"
            disabled={loading || generatingReport || calls.length === 0}
            onClick={() => void handleGenerateReport()}
            className="neo-panel__btn"
            title={
              isAdmin
                ? 'Actualiza el reporte closer de la fecha seleccionada'
                : 'Genera el reporte closer desde los datos del panel'
            }
          >
            {generatingReport ? 'Generando…' : 'Generar reporte'}
          </button>
          <button
            type="button"
            disabled={loading || pendingLoading}
            onClick={() => void fetchCalls()}
            className="neo-panel__btn neo-panel__btn--ghost"
          >
            {loading || pendingLoading ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>
      </header>

      <section className="neo-panel__module">
        <div className="neo-panel__module-head">
          <h2 className="neo-panel__module-title">
            {isToday ? 'Llamadas de hoy' : 'Llamadas del día'}
          </h2>
          <p className="neo-panel__module-hint">{countLabel}</p>
        </div>
        <DailyCallsTable
          items={calls}
          closerOptions={closerOptions}
          programOptions={programOptions}
          defaultCloser={defaultCloser}
          loading={loading}
          onStatusChange={handleStatusChange}
          onCloserChange={handleCloserChange}
          onCalificacionChange={handleCalificacionChange}
          onVinoDeAdsChange={handleVinoDeAdsChange}
          onFathomLinkChange={handleFathomLinkChange}
          onPaymentChange={handlePaymentChange}
          onOwedChange={handleOwedChange}
          onProgramOfferedChange={handleProgramOfferedChange}
          onProgramadaOfrecidoChange={handleProgramadaOfrecidoChange}
          onAddManualCall={() => setManualOpen(true)}
        />
      </section>

      <section className="neo-panel__module neo-panel__module--spaced">
        <div className="neo-panel__module-head">
          <h2 className="neo-panel__module-title">Agendas sin punto de agenda</h2>
          <p className="neo-panel__module-hint">
            {pendingMonthLabel} · {pendingCountLabel}
          </p>
        </div>
        <p className="neo-panel__module-desc">
          Leads que agendaron en el mes y todavía no tienen punto de agenda. El setter debe completarlos.
        </p>
        <PendingAgendaTable
          items={pendingAgenda}
          monthLabel={pendingMonthLabel}
          setterOptions={setterOptions}
          loading={pendingLoading}
          onAssign={(lead) => setAgendaModalLead(lead)}
          onSetterChange={handleSetterChange}
        />
      </section>

      {isAdmin ? (
        <section className="neo-panel__module neo-panel__module--spaced">
          <div className="neo-panel__module-head">
            <h2 className="neo-panel__module-title">Backup de datos</h2>
          </div>
          <p className="neo-panel__module-desc">
            Descargá un JSON con leads, reportes, equipo, historias, reels y listas maestras de tu cuenta.
          </p>
          <button
            type="button"
            disabled={downloadingBackup}
            onClick={() => void downloadFullBackup()}
            className="neo-panel__btn"
          >
            {downloadingBackup ? 'Descargando…' : 'Descargar backup completo'}
          </button>
        </section>
      ) : null}

      <AgendaPointPickerModal
        open={Boolean(agendaModalLead)}
        modalTitle="Punto de agenda"
        onClose={() => setAgendaModalLead(null)}
        hasAssignedPuntoAgenda={false}
        onSavePuntoAgenda={async (value) => {
          if (!agendaModalLead) return
          await handleAssignAgendaPoint(agendaModalLead.id, value)
          setAgendaModalLead(null)
        }}
        onCacheReel={() => undefined}
        onCacheSequence={() => undefined}
        onCacheYoutube={() => undefined}
      />

      {manualOpen ? (
        <div className="neo-manual-call">
          <div className="neo-manual-call__backdrop" onClick={() => setManualOpen(false)} />
          <div className="neo-manual-call__card" role="dialog" aria-labelledby="manual-call-title">
            <h3 id="manual-call-title" className="neo-manual-call__title">
              Agregar llamada manual
            </h3>
            <p className="neo-manual-call__hint">
              {isAdmin
                ? `El lead se crea para el ${formatIsoDateDdMmYyyy(selectedDate)} y aparece en la tabla leads.`
                : 'El lead se crea en la tabla leads y aparece en el panel de hoy.'}
            </p>
            <label className="neo-manual-call__field">
              <span>Nombre del lead</span>
              <input
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="Ej. Juan Pérez"
              />
            </label>
            <label className="neo-manual-call__field">
              <span>Hora (HH:MM)</span>
              <input
                value={manualHora}
                onChange={(e) => setManualHora(e.target.value)}
                placeholder="14:30"
              />
            </label>
            <label className="neo-manual-call__field">
              <span>Closer</span>
              <select value={manualCloser || defaultCloser} onChange={(e) => setManualCloser(e.target.value)}>
                {buildCloserOptions(closerOptions).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <div className="neo-manual-call__actions">
              <button type="button" className="neo-panel__btn neo-panel__btn--ghost" onClick={() => setManualOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="neo-panel__btn"
                disabled={manualSaving}
                onClick={() => void handleAddManualCall()}
              >
                {manualSaving ? 'Guardando…' : 'Agregar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </PanelShell>
  )
}
