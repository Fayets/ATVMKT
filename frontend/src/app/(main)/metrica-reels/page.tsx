'use client'

import { ReelsMetricsPanel } from '@/features/reels-metrics/components/reels-metrics-panel'

export default function MetricasReelsPage() {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold tracking-tight">Métrica Reels</h2>
        <p className="mt-1 text-[12px] text-[var(--text3)]">
          Comparativo de rendimiento por vistas, comentarios y compartidos.
        </p>
      </div>
      <ReelsMetricsPanel />
    </div>
  )
}
