'use client'

import { usePathname } from 'next/navigation'

const titles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/reels': 'Reels',
  '/keywords': 'Keyword',
  '/historias': 'Historias',
  '/youtube': 'YouTube',
  '/leads': 'Leads',
  '/sales-dashboard': 'Ventas',
  '/setter': 'Setter',
  '/closer': 'Closer',
  '/team': 'Equipo',
  '/bio': 'BIO',
  '/referidos': 'Referidos',
  '/diferidos': 'Diferidos',
  '/objetivos': 'Objetivos',
  '/listas': 'Listas Maestras',
  '/conexiones': 'Conexiones API',
  '/ajustes': 'Ajustes',
}

const subtitles: Record<string, string> = {
  '/dashboard': 'Contenido',
  '/sales-dashboard': 'Dashboard',
  '/setter': 'Metricas',
  '/closer': 'Metricas',
  '/team': 'Dashboard',
  '/bio': 'Canal directo',
  '/referidos': 'Canal directo',
  '/diferidos': 'Atribucion cruzada',
  '/listas': 'Configuracion',
  '/conexiones': 'Configuracion',
  '/ajustes': 'De la cuenta',
}

type TopbarProps = {
  userName: string
}

export function Topbar({ userName: _userName }: TopbarProps) {
  const pathname = usePathname()
  const hideTitleForPath = [
    '/reels',
    '/keywords',
    '/historias',
    '/youtube',
    '/bio',
    '/listas',
    '/conexiones',
    '/ajustes',
  ].includes(pathname)
  const title = titles[pathname] || 'Dashboard'
  const subtitle = subtitles[pathname]

  return (
    <header className="sticky top-0 z-10 flex items-center border-b border-[var(--border)] bg-[rgba(9,9,11,0.8)] px-8 py-4 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        {!hideTitleForPath && (
          <h1 className="text-[15px] font-semibold tracking-tight">
            {title}
            {subtitle && (
              <span className="font-semibold text-[var(--text2)]"> {subtitle}</span>
            )}
          </h1>
        )}
      </div>

    </header>
  )
}
