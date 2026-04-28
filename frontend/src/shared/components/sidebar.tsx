'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

type NavItem = { label: string; href: string }
type NavGroup = { title: string; icon: string; items: NavItem[]; defaultOpen?: boolean }

const navigation: NavGroup[] = [
  {
    title: 'Dashboard marketing', icon: '◆', defaultOpen: true,
    items: [
      { label: 'Resumen', href: '/dashboard' },
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
  const pathname = usePathname()

  return (
    <aside className="flex h-screen w-56 flex-shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg2)] sticky top-0">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 pt-6 pb-5">
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
        {navigation.map((group) => (
          <CollapsibleGroup key={group.title} group={group} pathname={pathname} />
        ))}

        {/* Data section */}
        <div className="px-3 pt-5 pb-2 text-[10px] font-medium uppercase tracking-widest text-[var(--text3)]">Datos</div>
        {dataGroups.map((group) => (
          <CollapsibleGroup key={group.title} group={group} pathname={pathname} showBadge />
        ))}

        {/* Settings */}
        <div className="px-3 pt-5 pb-2 text-[10px] font-medium uppercase tracking-widest text-[var(--text3)]">Ajustes</div>
        {settingsItems.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link key={item.href} href={item.href}
              className={`mx-1 mb-px flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-all ${
                isActive ? 'bg-[var(--accent-faint)] text-[var(--text)] font-medium' : 'text-[var(--text2)] hover:bg-[rgba(255,255,255,0.03)] hover:text-[var(--text)]'
              }`}>
              {isActive && <div className="h-1 w-1 rounded-full bg-[var(--accent)]" />}
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="mt-2 border-t border-[var(--border)] px-4 pb-3 pt-3 text-[9px] text-[var(--text3)]">
        © 2025-2026 Aumenta Tu Valor
      </div>
    </aside>
  )
}

function CollapsibleGroup({ group, pathname, showBadge }: { group: NavGroup; pathname: string; showBadge?: boolean }) {
  const hasActive = group.items.some(i => pathname === i.href)
  const [open, setOpen] = useState(false)

  return (
    <div className="mb-0.5">
      <button onClick={() => setOpen(!open)}
        className={`mx-1 w-[calc(100%-8px)] flex items-center gap-2 rounded-md px-3 py-2 text-[13px] font-medium transition-all text-left ${
          hasActive ? 'bg-[var(--accent-faint)] text-[var(--text)]' : 'text-[var(--text2)] hover:bg-[rgba(255,255,255,0.03)]'
        }`}>
        <span className={`text-[10px] transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>▸</span>
        <span className="flex-1">{group.title}</span>
        {showBadge && group.items.length > 0 && (
          <span className="rounded-full bg-[var(--bg4)] px-1.5 py-0 text-[10px] font-mono text-[var(--text3)] min-w-[18px] text-center">
            {group.items.length}
          </span>
        )}
      </button>
      {open && (
        <div className="ml-2">
          {group.items.map((item) => {
            const isActive = pathname === item.href
            return (
              <Link key={item.href} href={item.href}
                className={`mx-1 mb-px flex items-center gap-2 rounded-md px-4 py-1.5 text-[12px] transition-all ${
                  isActive ? 'text-[var(--text)] font-medium' : 'text-[var(--text2)] hover:text-[var(--text)] hover:bg-[rgba(255,255,255,0.03)]'
                }`}>
                {isActive && <div className="h-1 w-1 rounded-full bg-[var(--accent)]" />}
                {item.label}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
