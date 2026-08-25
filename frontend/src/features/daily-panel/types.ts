export type DailyCall = {
  id: number
  hora: string
  lead: string
  closer: string
  call_link: string
  status: string
  calificacion_llamada: '' | 'calificado' | 'descalificado'
  vino_de_ads: boolean
  program_offered: string
  programada_ofrecido_llamada: string
  payment: number
  owed: number
}

export type ManualCallInput = {
  client_name: string
  closer: string
  hora: string
  ig_handle?: string
  fecha?: string
}

export type DailyCallsResponse = {
  fecha: string
  llamadas: DailyCall[]
}

export type PendingAgendaLead = {
  id: number
  client_name: string
  ig_handle: string | null
  scheduled_at: string | null
  agendo: string | null
  setter: string | null
  /** Punto de agenda base (columna `via`): la pieza que trajo al lead. */
  entry_channel: string | null
}

export type PendingAgendaResponse = {
  month: string
  leads: PendingAgendaLead[]
}
