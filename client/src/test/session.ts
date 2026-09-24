import type { Role } from 'core/roles'
import { vi } from 'vitest'
import { authClient } from '@/lib/auth-client.ts'

// Sets what authClient.useSession() returns. The calling test file must mock the module:
// vi.mock('@/lib/auth-client.ts', () => ({ authClient: { useSession: vi.fn(), … } }))
export function mockSession(user: { name: string; role: Role } | null, { isPending = false } = {}) {
  const now = new Date()
  const data = user && {
    user: {
      id: 'user-1',
      name: user.name,
      email: 'user@example.com',
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
      role: user.role,
    },
    session: {
      id: 'session-1',
      userId: 'user-1',
      token: 'token',
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    },
  }
  vi.mocked(authClient.useSession).mockReturnValue({
    data,
    isPending,
    isRefetching: false,
    error: null,
    refetch: vi.fn(),
  })
}
