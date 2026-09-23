import { Role } from 'core/roles'
import { Navigate, Outlet } from 'react-router'
import { Skeleton } from '@/components/ui/skeleton.tsx'
import { authClient } from '../lib/auth-client.ts'
import Navbar from './Navbar.tsx'

function ProtectedLayout() {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) {
    // Mirrors the signed-in layout (navbar, then page) so nothing jumps when it resolves.
    return (
      <div className="min-h-svh bg-muted/40" aria-busy="true">
        <div className="border-b bg-background">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-8 w-32" />
          </div>
        </div>
        <main className="mx-auto max-w-6xl space-y-4 px-4 py-8">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72" />
        </main>
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="min-h-svh bg-gray-50">
      <Navbar userName={session.user.name} isAdmin={session.user.role === Role.admin} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}

export default ProtectedLayout