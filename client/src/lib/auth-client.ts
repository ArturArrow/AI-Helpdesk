import { createAuthClient } from 'better-auth/react'
import { inferAdditionalFields } from 'better-auth/client/plugins'
import type { auth } from '../../../server/src/lib/auth.ts'

// No baseURL: requests go to the current origin's /api/auth, which Vite proxies to the server.
export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<typeof auth>()],
})
