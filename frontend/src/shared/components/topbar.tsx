'use client'

import { usePathname } from 'next/navigation'
import { ThemeToggle } from '@/shared/components/theme-toggle'

const titles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/reels': 'Reels',
  '/keywords': 'Lead por reel',
  '/historias': 'Historias',
  '/youtube': 'YouTube',
  '/leads': 'Leads',
  '/hot-leads': 'Hot Leads',
  '/reporte-calls': 'Reporte calls',
  '/sales-dashboard': 'Ventas',
  '/team': 'Equipo',
  '/bio': 'BIO',
  '/referidos': 'Referidos',
  '/diferidos': 'Diferidos',
  '/objetivos': 'Objetivos',
  '/listas': 'Listas Maestras',
  '/programas': 'Programas',
  '/conexiones': 'Conexiones API',
}

const subtitles: Record<string, string> = {
  '/dashboard': 'Contenido',
  '/sales-dashboard': 'Dashboard',
  '/team': 'Dashboard',
  '/bio': 'Canal directo',
  '/referidos': 'Canal directo',
  '/diferidos': 'Atribucion cruzada',
  '/listas': 'Configuracion',
  '/programas': 'Configuracion',
  '/conexiones': 'Configuracion',
}

export function Topbar() {
  const pathname = usePathname()
  const hideTitleForPath = [
    '/reels',
    '/keywords',
    '/historias',
    '/youtube',
    '/bio',
    '/listas',
    '/programas',
    '/conexiones',
    '/team',
    '/team/reportes',
    '/team/historial-reportes',
  ].includes(pathname)
  const title = titles[pathname] || 'Dashboard'
  const subtitle = subtitles[pathname]

  return (
    <header className="sticky top-0 z-10 flex min-h-[56px] items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--topbar-bg)] px-8 py-4 backdrop-blur-xl">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {!hideTitleForPath && (
          <h1 className="text-[15px] font-semibold tracking-tight">
            {title}
            {subtitle && (
              <span className="font-semibold text-[var(--text2)]"> {subtitle}</span>
            )}
          </h1>
        )}
      </div>
      <div className="flex flex-shrink-0 items-center">
        <ThemeToggle />
      </div>
    </header>
  )
}
