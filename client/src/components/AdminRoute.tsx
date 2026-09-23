import { Role } from 'core/roles'
import { Navigate, Outlet } from 'react-router'
import { authClient } from '../lib/auth-client.ts'

// Nested inside ProtectedLayout, so a session is already guaranteed here.
function AdminRoute() {
  const { data: session } = authClient.useSession()

  if (session?.user.role !== Role.admin) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}

export default AdminRoute
