'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { logout } from '@/features/auth/services/auth-service'
import { useState } from 'react'

type NavItem = { label: string; href: string }
type NavGroup = {
  title: string
  icon: string
  items: NavItem[]
  defaultOpen?: boolean
  href?: string
}

const navigation: NavGroup[] = [
  {
    title: 'Dashboard marketing',
    icon: '◆',
    defaultOpen: true,
    items: [
      { label: 'Dashboard', href: '/dashboard' },
      { label: 'Métricas reels', href: '/metrica-reels' },
    ],
  },
  {
    title: 'Dashboard ventas', icon: '◆', defaultOpen: true,
    items: [
      { label: 'Panel', href: '/sales-dashboard' },
      { label: 'Setter', href: '/setter' },
      { label: 'Closer', href: '/closer' },
    ],
  },
]

const dataGroups: NavGroup[] = [
  {
    title: 'Trackeo de contenido', icon: '📊',
    items: [
      { label: 'Reels', href: '/reels' },
      { label: 'Historias', href: '/historias' },
      { label: 'YouTube', href: '/youtube' },
      { label: 'BIO', href: '/bio' },
      { label: 'Keyword', href: '/keywords' },
    ],
  },
  {
    title: 'Trackeo de ventas', icon: '💰',
    items: [
      { label: 'Leads', href: '/leads' },
    ],
  },
  {
    title: 'Trackeo de equipo', icon: '👥',
    items: [
      { label: 'Dashboard equipo', href: '/team' },
      { label: 'Carga de Reportes', href: '/team/reportes' },
    ],
  },
]

const settingsItems: NavItem[] = [
  { label: 'Listas maestras', href: '/listas' },
  { label: 'Conexiones API', href: '/conexiones' },
  { label: 'Ajustes de la cuenta', href: '/ajustes' },
]

export function Sidebar() {
  const router = useRouter()
  const pathname = usePathname()

  const onLogout = async () => {
    await logout()
    router.replace('/login')
  }

  return (
    <aside className="flex h-screen w-56 flex-shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg2)] sticky top-0">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 pt-4 pb-3">
        <svg viewBox="0 0 60 80" className="h-6 w-[18px] flex-shrink-0 opacity-90">
          <path d="M8 4 L32 4 L52 38 L36 38 L52 76 L28 76 L8 42 L26 42 Z" fill="#E63946" />
        </svg>
        <div>
          <div className="text-[13px] font-semibold tracking-tight leading-tight">Aumenta Tu Valor</div>
          <div className="text-[10px] text-[var(--text3)] font-normal mt-0.5">Laboratorio 3.0</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-1">
        {/* Dashboard groups */}
        <div className="flex flex-col gap-1">
          {navigation.map((group) => (
            <CollapsibleGroup key={group.title} group={group} pathname={pathname} />
          ))}
        </div>

        {/* Data section */}
        <div className="px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-widest text-[var(--text3)]">
          Datos
        </div>
        <div className="flex flex-col gap-1">
          {dataGroups.map((group) => (
            <CollapsibleGroup key={group.title} group={group} pathname={pathname} showBadge />
          ))}
        </div>

        {/* Settings */}
        <div className="px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-widest text-[var(--text3)]">
          Ajustes
        </div>
        {settingsItems.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`mx-1 mb-1 block min-h-7 truncate rounded-md border-l-2 py-1 pl-[calc(2.5rem-2px)] pr-2 text-[13px] transition-all ${
                isActive
                  ? 'border-[var(--accent)] bg-[var(--accent-faint)] text-[var(--text)] font-medium'
                  : 'border-transparent text-[var(--text2)] hover:bg-[rgba(255,255,255,0.03)] hover:text-[var(--text)]'
              }`}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="mt-1 border-t border-[var(--border)] px-4 pb-2 pt-2 text-[9px] text-[var(--text3)]">
        <div className="mb-2 flex items-center justify-between text-[11px]">
          <span className="text-[var(--text3)]">Invitado</span>
          <button
            type="button"
            onClick={onLogout}
            className="rounded-md border border-[var(--border2)] bg-transparent px-2 py-1 text-[10px] font-medium text-[var(--text3)] transition-all hover:border-[var(--accent)] hover:text-[var(--accent)] hover:bg-[var(--accent-faint)]"
          >
            Salir
          </button>
        </div>
        © 2025-2026 Aumenta Tu Valor
      </div>
    </aside>
  )
}

function CollapsibleGroup({ group, pathname, showBadge }: { group: NavGroup; pathname: string; showBadge?: boolean }) {
  const hasActive = group.items.some(i => pathname === i.href)
  const directActive = group.href ? pathname === group.href : false
  const [open, setOpen] = useState(group.defaultOpen ?? false)

  if (group.href) {
    return (
      <div className="mb-0">
        <Link
          href={group.href}
          className={`mx-1 flex w-[calc(100%-8px)] items-center rounded-md px-3 py-1.5 text-[13px] font-medium transition-all text-left ${
            directActive ? 'bg-[var(--accent-faint)] text-[var(--text)]' : 'text-[var(--text2)] hover:bg-[rgba(255,255,255,0.03)]'
          }`}
        >
          <span className="flex-1">{group.title}</span>
        </Link>
      </div>
    )
  }

  return (
    <div className="mb-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={open ? `Contraer menú: ${group.title}` : `Expandir menú: ${group.title}`}
        className={`mx-1 flex min-h-8 w-[calc(100%-8px)] items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium text-left transition-all ${
          hasActive ? 'bg-[var(--accent-faint)] text-[var(--text)]' : 'text-[var(--text2)] hover:bg-[rgba(255,255,255,0.03)]'
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{group.title}</span>
        {showBadge && group.items.length > 0 && (
          <span className="shrink-0 rounded-full bg-[var(--bg4)] px-1.5 py-0.5 text-[10px] font-mono tabular-nums text-[var(--text3)]">
            {group.items.length}
          </span>
        )}
      </button>
      {open && (
        <div className="mx-1 mt-0.5 flex flex-col gap-0.5 pr-1">
          {group.items.map((item) => {
            const isActive = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block min-h-7 truncate rounded-md border-l-2 py-1 pl-[calc(2.5rem-2px)] pr-2 text-[12px] transition-all ${
                  isActive
                    ? 'border-[var(--accent)] bg-[var(--accent-faint)] text-[var(--text)] font-medium'
                    : 'border-transparent text-[var(--text2)] hover:bg-[rgba(255,255,255,0.03)] hover:text-[var(--text)]'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
