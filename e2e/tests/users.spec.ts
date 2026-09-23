import { expect, test, type Page } from '@playwright/test'
import { ADMIN, AGENT, ORIGIN, signInViaApi } from '../fixtures/auth.js'
import { createUserViaApi, uniqueSuffix } from '../fixtures/users.js'

// The table row whose Email cell is exactly `email`.
function userRow(page: Page, email: string) {
  return page
    .getByRole('table')
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: email, exact: true }) })
}

// Clicks the row's "Edit <name>" button and returns the dialog it opens.
async function openEditDialog(page: Page, name: string) {
  await page.getByRole('button', { name: `Edit ${name}`, exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Edit user' })).toBeVisible()
  return dialog
}

// Collects PATCH requests to /api/users/:id sent from the page.
function trackPatchRequests(page: Page) {
  const urls: string[] = []
  page.on('request', (req) => {
    if (req.method() === 'PATCH' && req.url().includes('/api/users/')) urls.push(req.url())
  })
  return urls
}

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
    await expect(table.getByRole('columnheader')).toHaveText(['Name', 'Email', 'Role', 'Created', 'Actions'])

    for (const [user, role] of [
      [ADMIN, 'admin'],
      [AGENT, 'agent'],
    ] as const) {
      const row = table
        .getByRole('row')
        .filter({ has: page.getByRole('cell', { name: user.email, exact: true }) })
      await expect(row).toHaveCount(1)
      await expect(row.getByRole('cell')).toHaveText([user.name, user.email, role, /\d/, ''])
      await expect(row.getByRole('button', { name: `Edit ${user.name}`, exact: true })).toBeVisible()
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

test.describe('edit user dialog', () => {
  test('is pre-filled with the row\'s name and email and an empty password', async ({ page }) => {
    await signInViaApi(page.request, ADMIN)
    const user = await createUserViaApi(page.request, 'prefill')
    await page.goto('/users')

    const dialog = await openEditDialog(page, user.name)
    await expect(dialog.getByText('Leave the password blank to keep the current one.')).toBeVisible()
    await expect(dialog.getByLabel('Name')).toHaveValue(user.name)
    await expect(dialog.getByLabel('Email')).toHaveValue(user.email)
    await expect(dialog.getByLabel('Password')).toHaveValue('')
    await expect(dialog.getByRole('button', { name: 'Save changes' })).toBeEnabled()
  })

  test('admin changes name and email; the table updates and the change survives a reload', async ({
    page,
  }) => {
    await signInViaApi(page.request, ADMIN)
    const user = await createUserViaApi(page.request, 'rename')
    const suffix = uniqueSuffix()
    const newName = `Renamed ${suffix}`
    const newEmail = `renamed-${suffix}@example.com`
    await page.goto('/users')

    const dialog = await openEditDialog(page, user.name)
    await dialog.getByLabel('Name').fill(newName)
    // Upper-cased on input; the schema lower-cases it.
    await dialog.getByLabel('Email').fill(newEmail.toUpperCase())
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(dialog).toBeHidden()

    await expect(userRow(page, newEmail).getByRole('cell').first()).toHaveText(newName)
    await expect(userRow(page, user.email)).toHaveCount(0)

    await page.reload()
    await expect(userRow(page, newEmail).getByRole('cell').first()).toHaveText(newName)
    await expect(userRow(page, user.email)).toHaveCount(0)
  })

  test('a blank password keeps the old one working and leaves existing sessions alone', async ({
    page,
    playwright,
    baseURL,
  }) => {
    await signInViaApi(page.request, ADMIN)
    const user = await createUserViaApi(page.request, 'keeppw')
    const userCtx = await playwright.request.newContext({ baseURL })
    const fresh = await playwright.request.newContext({ baseURL })
    try {
      await signInViaApi(userCtx, user)
      await page.goto('/users')

      const newName = `Kept password ${uniqueSuffix()}`
      const dialog = await openEditDialog(page, user.name)
      await dialog.getByLabel('Name').fill(newName)
      await dialog.getByRole('button', { name: 'Save changes' }).click()
      await expect(dialog).toBeHidden()
      await expect(userRow(page, user.email).getByRole('cell').first()).toHaveText(newName)

      expect((await userCtx.get('/api/me')).status()).toBe(200)
      await signInViaApi(fresh, user)
    } finally {
      await Promise.all([userCtx.dispose(), fresh.dispose()])
    }
  })

  test('a new password replaces the old one and ends the user\'s sessions', async ({
    page,
    playwright,
    baseURL,
  }) => {
    await signInViaApi(page.request, ADMIN)
    const user = await createUserViaApi(page.request, 'newpw')
    const newPassword = `new-pw-${uniqueSuffix()}`
    const userCtx = await playwright.request.newContext({ baseURL })
    const fresh = await playwright.request.newContext({ baseURL })
    try {
      await signInViaApi(userCtx, user)
      expect((await userCtx.get('/api/me')).status()).toBe(200)
      await page.goto('/users')

      const dialog = await openEditDialog(page, user.name)
      await dialog.getByLabel('Password').fill(newPassword)
      await dialog.getByRole('button', { name: 'Save changes' }).click()
      await expect(dialog).toBeHidden()

      const me = await userCtx.get('/api/me')
      expect(me.status()).toBe(401)
      expect(await me.json()).toEqual({ error: 'Unauthorized' })

      const old = await fresh.post('/api/auth/sign-in/email', {
        headers: { Origin: ORIGIN },
        data: { email: user.email, password: user.password },
      })
      expect(old.status()).toBe(401)
      await signInViaApi(fresh, { ...user, password: newPassword })
    } finally {
      await Promise.all([userCtx.dispose(), fresh.dispose()])
    }
  })

  test('short name, invalid email and short password show field errors and send no request', async ({
    page,
  }) => {
    await signInViaApi(page.request, ADMIN)
    const user = await createUserViaApi(page.request, 'invalid')
    const patches = trackPatchRequests(page)
    await page.goto('/users')

    const dialog = await openEditDialog(page, user.name)
    await dialog.getByLabel('Name').fill('ab')
    await dialog.getByLabel('Email').fill('not-an-email')
    await dialog.getByLabel('Password').fill('short')
    await dialog.getByRole('button', { name: 'Save changes' }).click()

    await expect(dialog.getByRole('alert')).toHaveText([
      'Name must be at least 3 characters',
      'Enter a valid email address',
      'Password must be at least 8 characters',
    ])
    for (const label of ['Name', 'Email', 'Password']) {
      await expect(dialog.getByLabel(label)).toHaveAttribute('aria-invalid', 'true')
    }
    await expect(dialog).toBeVisible()
    expect(patches).toEqual([])

    await page.reload()
    await expect(userRow(page, user.email).getByRole('cell').first()).toHaveText(user.name)
  })

  test('an email that belongs to another user shows the 409 message under the email field', async ({
    page,
  }) => {
    await signInViaApi(page.request, ADMIN)
    const user = await createUserViaApi(page.request, 'conflict')
    await page.goto('/users')

    const dialog = await openEditDialog(page, user.name)
    await dialog.getByLabel('Email').fill(AGENT.email)
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes(`/api/users/${user.id}`)),
      dialog.getByRole('button', { name: 'Save changes' }).click(),
    ])
    expect(res.status()).toBe(409)

    await expect(dialog.getByRole('alert')).toHaveText(['A user with this email already exists'])
    await expect(dialog.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true')
    await expect(dialog).toBeVisible()

    await page.reload()
    await expect(userRow(page, user.email)).toHaveCount(1)
    await expect(userRow(page, AGENT.email).getByRole('cell').first()).toHaveText(AGENT.name)
  })
})

test.describe('PATCH /api/users/:id', () => {
  test('admin gets 200 with the updated user and only public fields', async ({ request }) => {
    await signInViaApi(request, ADMIN)
    const user = await createUserViaApi(request, 'apiedit')
    const suffix = uniqueSuffix()

    const res = await request.patch(`/api/users/${user.id}`, {
      data: { name: `  Api edited ${suffix}  `, email: `API-EDITED-${suffix}@EXAMPLE.COM`, password: '' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Object.keys(body.user).sort()).toEqual(['createdAt', 'email', 'id', 'name', 'role'])
    expect(body.user).toMatchObject({
      id: user.id,
      name: `Api edited ${suffix}`,
      email: `api-edited-${suffix}@example.com`,
      role: 'agent',
    })
  })

  test('the server rejects invalid bodies with 400 even without the form', async ({ request }) => {
    await signInViaApi(request, ADMIN)
    const user = await createUserViaApi(request, 'apiinvalid')

    for (const [data, error] of [
      [{ name: 'ab', email: user.email }, 'Name must be at least 3 characters'],
      [{ name: user.name, email: 'not-an-email' }, 'Enter a valid email address'],
      [{ name: user.name, email: user.email, password: 'short' }, 'Password must be at least 8 characters'],
    ] as const) {
      const res = await request.patch(`/api/users/${user.id}`, { data })
      expect(res.status(), JSON.stringify(data)).toBe(400)
      expect(await res.json()).toEqual({ error })
    }
    // Nothing was changed.
    const { users } = await (await request.get('/api/users')).json()
    expect(users).toContainEqual(expect.objectContaining({ id: user.id, name: user.name, email: user.email }))
  })

  test('admin gets 404 for an unknown id', async ({ request }) => {
    await signInViaApi(request, ADMIN)

    const res = await request.patch('/api/users/does-not-exist', {
      data: { name: 'Nobody here', email: `nobody-${uniqueSuffix()}@example.com` },
    })
    expect(res.status()).toBe(404)
    expect(await res.json()).toEqual({ error: 'User not found' })
  })

  test('agent gets 403 and unauthenticated gets 401; the user is unchanged', async ({
    playwright,
    baseURL,
  }) => {
    const admin = await playwright.request.newContext({ baseURL })
    const agent = await playwright.request.newContext({ baseURL })
    const anon = await playwright.request.newContext({ baseURL })
    try {
      await signInViaApi(admin, ADMIN)
      await signInViaApi(agent, AGENT)
      const user = await createUserViaApi(admin, 'guarded')
      const data = { name: 'Hijacked', email: `hijacked-${uniqueSuffix()}@example.com`, password: 'hijacked-password' }

      const g = await agent.patch(`/api/users/${user.id}`, { data })
      expect(g.status()).toBe(403)
      expect(await g.json()).toEqual({ error: 'Forbidden' })

      const a = await anon.patch(`/api/users/${user.id}`, { data })
      expect(a.status()).toBe(401)
      expect(await a.json()).toEqual({ error: 'Unauthorized' })

      const { users } = await (await admin.get('/api/users')).json()
      expect(users).toContainEqual(expect.objectContaining({ id: user.id, name: user.name, email: user.email }))
      await signInViaApi(anon, user)
    } finally {
      await Promise.all([admin.dispose(), agent.dispose(), anon.dispose()])
    }
  })
})
