import { Navigate, Outlet } from 'react-router'
import { authClient } from '../lib/auth-client.ts'
import Navbar from './Navbar.tsx'

function ProtectedLayout() {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) {
    return (
      <div className="flex min-h-svh items-center justify-center text-gray-500">
        Loading…
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="min-h-svh bg-gray-50">
      <Navbar userName={session.user.name} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}

export default ProtectedLayout