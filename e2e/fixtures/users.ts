import { expect, type APIRequestContext } from '@playwright/test'
import type { Credentials } from './auth.js'

export type CreatedUser = Credentials & { id: string }

// The "AI" system agent, inserted by server/prisma/migrations/20261103120000_add_ai_agent, so it
// exists after every reset. It has no account row (can't sign in), is hidden from GET /api/users
// and the assignee list, and holds tickets only when the AI pipeline (or setTicketInDb) assigns it.
export const AI_AGENT = { id: 'ai-agent', name: 'AI', email: 'ai@helpdesk.local' }

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

// Soft-deletes a user through DELETE /api/users/:id. `request` must be signed in as the admin.
export async function deleteUserViaApi(request: APIRequestContext, id: string) {
  const res = await request.delete(`/api/users/${id}`)
  expect(res.status(), `delete ${id}`).toBe(204)
}
