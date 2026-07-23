export type DailyCall = {
  id: number
  hora: string
  lead: string
  closer: string
  call_link: string
  status: string
  program_offered: string
  programada_ofrecido_llamada: string
  payment: number
  owed: number
}

export type DailyCallsResponse = {
  fecha: string
  llamadas: DailyCall[]
}
