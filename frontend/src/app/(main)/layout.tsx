import { Sidebar } from '@/shared/components/sidebar'
import { Topbar } from '@/shared/components/topbar'
import { AppProviders } from '@/shared/components/app-providers'
import { AuthGuard } from '@/shared/components/auth-guard'
import { PointerTracker } from '@/shared/components/pointer-tracker'

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const userName = 'Invitado'

  return (
    <AppProviders>
      <AuthGuard>
        <div className="flex min-h-screen relative">
          <PointerTracker />
          {/* Dots background — static div, not client component */}
          <div
            aria-hidden="true"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 0,
              pointerEvents: 'none',
              backgroundImage: 'radial-gradient(circle, rgba(255, 255, 255, 0.1) 1px, transparent 1px)',
              backgroundSize: '22px 22px',
              maskImage: 'radial-gradient(ellipse at center, black 20%, transparent 70%)',
              WebkitMaskImage: 'radial-gradient(ellipse at center, black 20%, transparent 70%)',
            }}
          />
          <Sidebar />
          <div className="flex flex-1 flex-col min-w-0 relative z-[1]">
            <Topbar userName={userName} />
            <main className="flex-1 p-8 max-w-[1580px]">
              {children}
            </main>
          </div>
        </div>
      </AuthGuard>
    </AppProviders>
  )
}
