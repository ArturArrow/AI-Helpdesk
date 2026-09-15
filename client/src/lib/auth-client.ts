import { createAuthClient } from 'better-auth/react'

// No baseURL: requests go to the current origin's /api/auth, which Vite proxies to the server.
export const authClient = createAuthClient()
