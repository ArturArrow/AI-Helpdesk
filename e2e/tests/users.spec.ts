import { expect, test } from '@playwright/test'
import { ADMIN, AGENT, signInViaApi } from '../fixtures/auth.js'

test.describe('GET /api/users', () => {
  test('returns the seeded admin and agent with only public fields', async ({ request }) => {
    await signInViaApi(request, ADMIN)

    const res = await request.get('/api/users')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.users)).toBe(true)

    for (const user of body.users) {
      expect(Object.keys(user).sort()).toEqual(['createdAt', 'email', 'id', 'name', 'role'])
      expect(Number.isNaN(Date.parse(user.createdAt))).toBe(false)
    }

    expect(body.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: ADMIN.email, name: ADMIN.name, role: 'admin' }),
        expect.objectContaining({ email: AGENT.email, name: AGENT.name, role: 'agent' }),
      ]),
    )
  })

  test('orders users by createdAt ascending', async ({ request }) => {
    await signInViaApi(request, ADMIN)

    const { users } = await (await request.get('/api/users')).json()
    const times = users.map((u: { createdAt: string }) => Date.parse(u.createdAt))
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })
})

test.describe('/users page', () => {
  test('admin sees a table with both seeded users', async ({ page }) => {
    await signInViaApi(page.request, ADMIN)
    await page.goto('/users')

    const table = page.getByRole('table')
    await expect(table).toBeVisible()
    await expect(table.getByRole('columnheader')).toHaveText(['Name', 'Email', 'Role', 'Created'])

    for (const [user, role] of [
      [ADMIN, 'admin'],
      [AGENT, 'agent'],
    ] as const) {
      const row = table
        .getByRole('row')
        .filter({ has: page.getByRole('cell', { name: user.email, exact: true }) })
      await expect(row).toHaveCount(1)
      await expect(row.getByRole('cell')).toHaveText([user.name, user.email, role, /\d/])
    }
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

  test('shows an alert when /api/users fails', async ({ page }) => {
    await signInViaApi(page.request, ADMIN)
    await page.route('**/api/users', (route) =>
      route.fulfill({ status: 500, json: { error: 'Internal Server Error' } }),
    )
    await page.goto('/users')

    await expect(page.getByRole('alert')).toHaveText("Couldn't load users: Request failed (500)")
    await expect(page.getByRole('table')).toHaveCount(0)
  })
})
