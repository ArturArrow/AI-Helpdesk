import { expect, type APIRequestContext } from '@playwright/test'
import type { Credentials } from './auth.js'

export type CreatedUser = Credentials & { id: string }

// Unique per call, so re-runs on the same database and several users per test don't collide.
export function uniqueSuffix() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// Creates an agent through POST /api/users. `request` must already be signed in as the admin.
export async function createUserViaApi(request: APIRequestContext, label = 'user'): Promise<CreatedUser> {
  const suffix = uniqueSuffix()
  const data = {
    name: `E2E ${label} ${suffix}`,
    email: `${label}-${suffix}@example.com`,
    password: `pw-${suffix}`,
  }
  const res = await request.post('/api/users', { data })
  expect(res.status(), `create ${data.email}`).toBe(201)
  const { user } = await res.json()
  return { ...data, id: user.id }
}
