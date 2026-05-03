'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { logout } from '@/features/auth/services/auth-service'
import { useState } from 'react'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { BrandLogo } from '@/shared/components/brand-logo'

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
    items: [{ label: 'Panel', href: '/sales-dashboard' }],
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
      { label: 'Historial de reportes', href: '/team/historial-reportes' },
      { label: 'Equipo', href: '/team/equipo' },
    ],
  },
]

const settingsGroup: NavGroup = {
  title: 'Ajustes',
  icon: '⚙',
  defaultOpen: true,
  items: [
    { label: 'Listas maestras', href: '/listas' },
    { label: 'Conexiones API', href: '/conexiones' },
  ],
}

function capitalizeFirstLetter(label: string): string {
  if (!label) return label
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export function Sidebar() {
  const router = useRouter()
  const pathname = usePathname()
  const { username, ready } = useAuthUser()
  const trimmed = username?.trim() || ''
  const displayName = !ready ? '…' : trimmed ? capitalizeFirstLetter(trimmed) : 'Usuario'

  const onLogout = async () => {
    await logout()
    router.replace('/login')
  }

  return (
    <aside className="flex h-screen w-56 flex-shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg2)] sticky top-0">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 pt-4 pb-3">
        <BrandLogo className="h-8 w-auto flex-shrink-0 object-contain opacity-95" />
        <div>
          <div className="text-[13px] font-semibold tracking-tight leading-tight">ATV</div>
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

        <div className="flex flex-col gap-1 border-t border-[var(--border)] pt-2 mt-1">
          <CollapsibleGroup group={settingsGroup} pathname={pathname} showBadge />
        </div>
      </nav>

      {/* Footer */}
      <div className="mt-1 border-t border-[var(--border)] px-4 pb-2 pt-2 text-[9px] text-[var(--text3)]">
        <div className="mb-2 flex items-center justify-between gap-2 text-[11px]">
          <span className="min-w-0 truncate font-medium text-[var(--text2)]" title={displayName}>
            {displayName}
          </span>
          <button
            type="button"
            onClick={onLogout}
            className="shrink-0 rounded-md border border-[var(--border2)] bg-transparent px-2 py-1 text-[10px] font-medium text-[var(--text3)] transition-all hover:border-[var(--accent)] hover:bg-[var(--accent-faint)] hover:text-[var(--accent)]"
          >
            Salir
          </button>
        </div>
        © 2025-2026 ATV
      </div>
    </aside>
  )
}

function CollapsibleGroup({ group, pathname, showBadge }: { group: NavGroup; pathname: string; showBadge?: boolean }) {
  const directActive = group.href ? pathname === group.href : false
  const [open, setOpen] = useState(group.defaultOpen ?? false)

  if (group.href) {
    return (
      <div className="mb-0">
        <Link
          href={group.href}
          className={`mx-1 flex w-[calc(100%-8px)] items-center rounded-md px-3 py-1.5 text-[13px] font-medium transition-all text-left ${
            directActive ? 'bg-[var(--accent-faint)] text-[var(--text)]' : 'text-[var(--text2)] hover:bg-[var(--nav-hover)]'
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
        className="mx-1 flex min-h-8 w-[calc(100%-8px)] items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium text-left text-[var(--text2)] transition-all hover:bg-[var(--nav-hover)]"
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
                    : 'border-transparent text-[var(--text2)] hover:bg-[var(--nav-hover)] hover:text-[var(--text)]'
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
