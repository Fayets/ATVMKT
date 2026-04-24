'use client'

import { DailyReportSection } from '@/features/team/components/daily-report-form'

export default function ReportesPage() {
  return (
    <div className="space-y-8">
      <h2 className="text-lg font-semibold tracking-tight">Carga de Reportes</h2>
      <div>
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-[var(--text3)] mb-4">Setter</h3>
        <DailyReportSection role="setter" />
      </div>
      <div>
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-[var(--text3)] mb-4">Closer</h3>
        <DailyReportSection role="closer" />
      </div>
    </div>
  )
}
