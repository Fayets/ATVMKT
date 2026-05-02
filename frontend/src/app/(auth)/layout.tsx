import { ThemeToggle } from '@/shared/components/theme-toggle'

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[var(--bg)]">
      <div className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md px-6">
        {/* Logo */}
        <div className="mb-10 flex items-center gap-3">
          <svg viewBox="0 0 60 80" className="h-8 w-6 opacity-90">
            <path d="M8 4 L32 4 L52 38 L36 38 L52 76 L28 76 L8 42 L26 42 Z" fill="#E63946" />
          </svg>
          <div>
            <div className="text-sm font-semibold tracking-tight text-[var(--text)]">
              Laboratorio de Contenido
            </div>
            <div className="text-[11px] text-[var(--text3)]">
              Aumenta Tu Valor
            </div>
          </div>
        </div>

        {/* Glass card */}
        <div className="glass-card relative p-8 accent-top">
          {children}
        </div>
      </div>
    </div>
  )
}
