'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { useToast } from '@/shared/components/toast'
import { formatIsoDateDdMmYyyy } from '@/shared/lib/format-utils'
import {
  getDailyCalls,
  getProgramOptions,
  getTeamClosers,
  patchLeadCallLink,
  patchLeadCloser,
  patchLeadOwed,
  patchLeadPayment,
  patchLeadProgramOffered,
  patchLeadProgramadaOfrecido,
  patchLeadStatus,
  resolveDefaultCloser,
} from '../services/daily-panel-service'
import { DEFAULT_DAILY_CLOSER } from '../constants'
import type { DailyCall } from '../types'
import { DailyCallsTable } from './daily-calls-table'
import '../daily-panel.css'

const AR_TZ = 'America/Argentina/Buenos_Aires'

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

function PanelShell({ children }: { children: ReactNode }) {
  return (
    <div className="neo-panel">
      <div className="neo-panel__inner">{children}</div>
    </div>
  )
}

export function DailyPanelPage() {
  const { ready, userId } = useAuthUser()
  const { toast } = useToast()
  const [fecha, setFecha] = useState('')
  const [calls, setCalls] = useState<DailyCall[]>([])
  const [closerOptions, setCloserOptions] = useState<string[]>([])
  const [programOptions, setProgramOptions] = useState<string[]>([''])
  const [defaultCloser, setDefaultCloser] = useState(DEFAULT_DAILY_CLOSER)
  const [loading, setLoading] = useState(true)
  const clock = useArgentinaClock(ready && Boolean(userId))

  const fetchCalls = useCallback(
    async (silent = false) => {
      if (!ready || !userId) {
        setCalls([])
        setFecha('')
        setLoading(false)
        return
      }
      if (!silent) setLoading(true)
      try {
        let closers: string[] = []
        try {
          closers = await getTeamClosers()
        } catch {
          closers = []
        }
        const resolvedDefault = resolveDefaultCloser(closers)
        setCloserOptions(closers)
        setDefaultCloser(resolvedDefault)
        void getProgramOptions()
          .then(setProgramOptions)
          .catch(() => setProgramOptions(['']))
        const data = await getDailyCalls(closers, resolvedDefault)
        setFecha(data.fecha)
        setCalls(data.llamadas)
      } catch (e) {
        if (!silent) {
          toast(e instanceof Error ? e.message : 'Error al cargar el panel.')
        }
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [ready, userId, toast],
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

  const fechaLabel = fecha ? formatIsoDateDdMmYyyy(fecha) : 'HOY'
  const countLabel =
    calls.length === 1 ? '1 llamada' : `${calls.length} llamadas`

  return (
    <PanelShell>
      <header className="neo-panel__header">
        <div>
          <h1 className="neo-panel__title">Dashboard diario</h1>
          <p className="neo-panel__subtitle">
            {fechaLabel} · Argentina
          </p>
        </div>
        <div className="neo-panel__header-meta">
          {clock ? <span className="neo-panel__clock">{clock}</span> : null}
          <button
            type="button"
            disabled={loading}
            onClick={() => void fetchCalls()}
            className="neo-panel__btn"
          >
            {loading ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>
      </header>

      <section className="neo-panel__module">
        <div className="neo-panel__module-head">
          <h2 className="neo-panel__module-title">Llamadas de hoy</h2>
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
          onFathomLinkChange={handleFathomLinkChange}
          onPaymentChange={handlePaymentChange}
          onOwedChange={handleOwedChange}
          onProgramOfferedChange={handleProgramOfferedChange}
          onProgramadaOfrecidoChange={handleProgramadaOfrecidoChange}
        />
      </section>
    </PanelShell>
  )
}
