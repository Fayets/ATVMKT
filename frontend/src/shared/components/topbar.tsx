'use client'

import { usePathname } from 'next/navigation'
import { useRouter } from 'next/navigation'
import { logout } from '@/features/auth/services/auth-service'

const titles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/reels': 'Reels',
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
  '/leads': 'Tracking de leads',
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

export function Topbar({ userName }: TopbarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const title = titles[pathname] || 'Dashboard'
  const subtitle = subtitles[pathname]

  const onLogout = async () => {
    await logout()
    router.replace('/login')
  }

  return (
    <header className="sticky top-0 z-10 flex items-center border-b border-[var(--border)] bg-[rgba(9,9,11,0.8)] px-8 py-4 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <h1 className="text-[15px] font-semibold tracking-tight">
          {title}
          {subtitle && (
            <span className="font-semibold text-[var(--text2)]"> {subtitle}</span>
          )}
        </h1>
      </div>

      <div className="ml-auto flex items-center gap-4">
        <span className="text-[12px] text-[var(--text3)]">
          {userName}
        </span>
        <button
          type="button"
          onClick={onLogout}
          className="rounded-lg border border-[var(--border2)] bg-transparent px-3 py-1.5 text-[11px] font-medium text-[var(--text3)] transition-all hover:border-[var(--accent)] hover:text-[var(--accent)] hover:bg-[var(--accent-faint)]"
        >
          Salir
        </button>
      </div>
    </header>
  )
}
