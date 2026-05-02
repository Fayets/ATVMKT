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
  return (
    <AppProviders>
      <AuthGuard>
        <div className="flex min-h-screen relative">
          <PointerTracker />
          {/* Dots background — static div, not client component */}
          <div aria-hidden="true" className="app-dots-bg" />
          <Sidebar />
          <div className="flex flex-1 flex-col min-w-0 relative z-[1]">
            <Topbar />
            <main className="flex-1 p-8 max-w-[1580px]">
              {children}
            </main>
          </div>
        </div>
      </AuthGuard>
    </AppProviders>
  )
}
