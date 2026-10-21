import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { ADMIN, AGENT, ORIGIN, signInViaApi, submitLoginForm } from '../fixtures/auth.js'
import { createTicketViaWebhook, updateTicketViaApi } from '../fixtures/tickets.js'
import { createUserViaApi, deleteUserViaApi, uniqueSuffix } from '../fixtures/users.js'

// The table row whose Email cell is exactly `email`.
function userRow(page: Page, email: string) {
  return page
    .getByRole('table')
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: email, exact: true }) })
}

// Clicks "New user" above the table and returns the dialog it opens.
async function openNewUserDialog(page: Page) {
  await page.getByRole('button', { name: 'New user', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'New user' })).toBeVisible()
  await expect(dialog.getByText('Create an agent account.')).toBeVisible()
  return dialog
}

// Fills the New user dialog and submits it; returns the POST /api/users response.
async function submitNewUser(page: Page, dialog: Locator, user: { name: string; email: string; password: string }) {
  await dialog.getByLabel('Name').fill(user.name)
  await dialog.getByLabel('Email').fill(user.email)
  await dialog.getByLabel('Password').fill(user.password)
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/api/users')),
    dialog.getByRole('button', { name: 'Create user' }).click(),
  ])
  return res
}

// Clicks the row's "Edit <name>" button and returns the dialog it opens.
async function openEditDialog(page: Page, name: string) {
  await page.getByRole('button', { name: `Edit ${name}`, exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Edit user' })).toBeVisible()
  return dialog
}

// Clicks the row's "Delete <name>" button and returns the dialog it opens.
async function openDeleteDialog(page: Page, name: string) {
  await page.getByRole('button', { name: `Delete ${name}`, exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Delete user' })).toBeVisible()
  return dialog
}

// GET /api/tickets/:id as `request`'s session; asserts 200 and returns the ticket.
async function getTicket(request: APIRequestContext, id: number) {
  const res = await request.get(`/api/tickets/${id}`)
  expect(res.status(), `get ticket ${id}`).toBe(200)
  return (await res.json()).ticket
}

// Signs in through the API with `user`'s credentials and returns the response, without asserting.
function postSignIn(request: APIRequestContext, user: { email: string; password: string }) {
  return request.post('/api/auth/sign-in/email', {
    headers: { Origin: ORIGIN },
    data: { email: user.email, password: user.password },
  })
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

test.describe('new user dialog', () => {
  test('admin creates an agent; the row appears, survives a reload, and the user can sign in', async ({
    page,
    playwright,
    baseURL,
  }) => {
    await signInViaApi(page.request, ADMIN)
    const suffix = uniqueSuffix()
    const user = { name: `Created ${suffix}`, email: `created-${suffix}@example.com`, password: `pw-${suffix}` }
    await page.goto('/users')

    const dialog = await openNewUserDialog(page)
    // Upper-cased on input; the schema lower-cases it.
    const res = await submitNewUser(page, dialog, { ...user, email: user.email.toUpperCase() })
    expect(res.status()).toBe(201)
    await expect(dialog).toBeHidden()

    await expect(userRow(page, user.email).getByRole('cell')).toHaveText([user.name, user.email, 'agent', /\d/, ''])
    await page.reload()
    await expect(userRow(page, user.email).getByRole('cell')).toHaveText([user.name, user.email, 'agent', /\d/, ''])

    const userCtx = await playwright.request.newContext({ baseURL })
    try {
      await signInViaApi(userCtx, user)
      const me = await userCtx.get('/api/me')
      expect(me.status()).toBe(200)
      expect((await me.json()).user).toMatchObject({ name: user.name, email: user.email, role: 'agent' })
    } finally {
      await userCtx.dispose()
    }
  })

  test('full lifecycle: create, see in the list, edit, delete', async ({ page }) => {
    await signInViaApi(page.request, ADMIN)
    const suffix = uniqueSuffix()
    const user = { name: `Lifecycle ${suffix}`, email: `lifecycle-${suffix}@example.com`, password: `pw-${suffix}` }
    const edited = { name: `Lifecycle edited ${suffix}`, email: `lifecycle-edited-${suffix}@example.com` }
    await page.goto('/users')

    // Create
    const createDialog = await openNewUserDialog(page)
    const created = await submitNewUser(page, createDialog, user)
    expect(created.status()).toBe(201)
    const { user: { id } } = await created.json()
    await expect(createDialog).toBeHidden()

    // Read
    await expect(userRow(page, user.email).getByRole('cell')).toHaveText([user.name, user.email, 'agent', /\d/, ''])

    // Update
    const editDialog = await openEditDialog(page, user.name)
    await editDialog.getByLabel('Name').fill(edited.name)
    await editDialog.getByLabel('Email').fill(edited.email)
    await editDialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(editDialog).toBeHidden()
    await expect(userRow(page, edited.email).getByRole('cell')).toHaveText([edited.name, edited.email, 'agent', /\d/, ''])
    await expect(userRow(page, user.email)).toHaveCount(0)

    // Delete
    const deleteDialog = await openDeleteDialog(page, edited.name)
    await expect(deleteDialog).toContainText(`Delete ${edited.name} (${edited.email})?`)
    await deleteDialog.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(deleteDialog).toBeHidden()
    await expect(userRow(page, edited.email)).toHaveCount(0)

    await page.reload()
    await expect(userRow(page, AGENT.email)).toHaveCount(1)
    await expect(userRow(page, edited.email)).toHaveCount(0)
    await expect(userRow(page, user.email)).toHaveCount(0)

    const { users } = await (await page.request.get('/api/users')).json()
    expect(users.map((u: { id: string }) => u.id)).not.toContain(id)
  })
})

test.describe('POST /api/users', () => {
  test('admin gets 201 with the new agent, and it appears in GET /api/users', async ({ request }) => {
    await signInViaApi(request, ADMIN)
    const suffix = uniqueSuffix()

    const res = await request.post('/api/users', {
      data: { name: `  Api created ${suffix}  `, email: `API-CREATED-${suffix}@EXAMPLE.COM`, password: `pw-${suffix}` },
    })
    expect(res.status()).toBe(201)
    const { user } = await res.json()
    expect(Object.keys(user).sort()).toEqual(['createdAt', 'email', 'id', 'name', 'role'])
    expect(user).toMatchObject({
      name: `Api created ${suffix}`,
      email: `api-created-${suffix}@example.com`,
      role: 'agent',
    })
    expect(typeof user.id).toBe('string')
    expect(Number.isNaN(Date.parse(user.createdAt))).toBe(false)

    const { users } = await (await request.get('/api/users')).json()
    expect(users).toContainEqual(user)
  })
})

test.describe('edit user dialog', () => {
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

  test('changing the email to another user\'s gets 409; the user is unchanged', async ({ request }) => {
    await signInViaApi(request, ADMIN)
    const user = await createUserViaApi(request, 'conflict')

    const res = await request.patch(`/api/users/${user.id}`, {
      data: { name: user.name, email: AGENT.email },
    })
    expect(res.status()).toBe(409)
    expect(await res.json()).toEqual({ error: 'A user with this email already exists' })

    const { users } = await (await request.get('/api/users')).json()
    expect(users).toContainEqual(expect.objectContaining({ id: user.id, name: user.name, email: user.email }))
    expect(users).toContainEqual(expect.objectContaining({ email: AGENT.email, name: AGENT.name }))
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

test.describe('a deleted user', () => {
  test('loses their existing session', async ({ request, playwright, baseURL }) => {
    await signInViaApi(request, ADMIN)
    const user = await createUserViaApi(request, 'delsession')
    const userCtx = await playwright.request.newContext({ baseURL })
    try {
      await signInViaApi(userCtx, user)
      expect((await userCtx.get('/api/me')).status()).toBe(200)

      await deleteUserViaApi(request, user.id)

      const me = await userCtx.get('/api/me')
      expect(me.status()).toBe(401)
      expect(await me.json()).toEqual({ error: 'Unauthorized' })
    } finally {
      await userCtx.dispose()
    }
  })

  test('cannot sign in with the correct password through the API; the error matches a wrong password', async ({
    request,
    playwright,
    baseURL,
  }) => {
    await signInViaApi(request, ADMIN)
    const user = await createUserViaApi(request, 'delapisignin')
    await deleteUserViaApi(request, user.id)
    const fresh = await playwright.request.newContext({ baseURL })
    try {
      const deleted = await postSignIn(fresh, user)
      expect(deleted.status()).toBe(401)
      const wrong = await postSignIn(fresh, { email: AGENT.email, password: 'definitely-wrong-password' })
      expect(wrong.status()).toBe(401)
      expect((await deleted.json()).message).toBe((await wrong.json()).message)
      expect((await fresh.get('/api/me')).status()).toBe(401)
    } finally {
      await fresh.dispose()
    }
  })

  test('signing in with the correct password in the UI shows "Invalid email or password"', async ({
    page,
    request,
  }) => {
    await signInViaApi(request, ADMIN)
    const user = await createUserViaApi(request, 'deluisignin')
    await deleteUserViaApi(request, user.id)

    await page.goto('/login')
    await submitLoginForm(page, user.email, user.password)

    await expect(page.getByRole('alert')).toContainText('Invalid email or password')
    await expect(page).toHaveURL('/login')
    await expect(page.getByRole('navigation')).toHaveCount(0)
  })
})

test.describe('DELETE /api/users/:id', () => {
  test('admin gets 204 with no body, and the user is gone from GET /api/users', async ({ request }) => {
    await signInViaApi(request, ADMIN)
    const user = await createUserViaApi(request, 'delapi')

    const res = await request.delete(`/api/users/${user.id}`)
    expect(res.status()).toBe(204)
    expect(await res.text()).toBe('')

    const { users } = await (await request.get('/api/users')).json()
    expect(users.map((u: { id: string }) => u.id)).not.toContain(user.id)
    expect(users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: ADMIN.email }),
        expect.objectContaining({ email: AGENT.email }),
      ]),
    )
  })

  test('deleting the seeded admin (self) gets 403 and the admin still signs in', async ({
    request,
    playwright,
    baseURL,
  }) => {
    await signInViaApi(request, ADMIN)
    const { user: me } = await (await request.get('/api/me')).json()

    const res = await request.delete(`/api/users/${me.id}`)
    expect(res.status()).toBe(403)
    expect(await res.json()).toEqual({ error: 'Admins cannot be deleted' })

    expect((await request.get('/api/me')).status()).toBe(200)
    const { users } = await (await request.get('/api/users')).json()
    expect(users).toContainEqual(expect.objectContaining({ id: me.id, email: ADMIN.email }))
    const fresh = await playwright.request.newContext({ baseURL })
    try {
      await signInViaApi(fresh, ADMIN)
    } finally {
      await fresh.dispose()
    }
  })

  test('an unknown id gets 404', async ({ request }) => {
    await signInViaApi(request, ADMIN)

    const res = await request.delete('/api/users/does-not-exist')
    expect(res.status()).toBe(404)
    expect(await res.json()).toEqual({ error: 'User not found' })
  })

  test('deleting the same user twice gets 404 the second time', async ({ request }) => {
    await signInViaApi(request, ADMIN)
    const user = await createUserViaApi(request, 'deltwice')

    await deleteUserViaApi(request, user.id)
    const again = await request.delete(`/api/users/${user.id}`)
    expect(again.status()).toBe(404)
    expect(await again.json()).toEqual({ error: 'User not found' })
  })

  test('agent gets 403 and unauthenticated gets 401; the user is not deleted', async ({
    playwright,
    baseURL,
  }) => {
    const admin = await playwright.request.newContext({ baseURL })
    const agent = await playwright.request.newContext({ baseURL })
    const anon = await playwright.request.newContext({ baseURL })
    try {
      await signInViaApi(admin, ADMIN)
      await signInViaApi(agent, AGENT)
      const user = await createUserViaApi(admin, 'delguarded')

      const g = await agent.delete(`/api/users/${user.id}`)
      expect(g.status()).toBe(403)
      expect(await g.json()).toEqual({ error: 'Forbidden' })

      const a = await anon.delete(`/api/users/${user.id}`)
      expect(a.status()).toBe(401)
      expect(await a.json()).toEqual({ error: 'Unauthorized' })

      const { users } = await (await admin.get('/api/users')).json()
      expect(users).toContainEqual(expect.objectContaining({ id: user.id }))
      await signInViaApi(anon, user)
    } finally {
      await Promise.all([admin.dispose(), agent.dispose(), anon.dispose()])
    }
  })

  test('PATCH on a deleted user gets 404', async ({ request }) => {
    await signInViaApi(request, ADMIN)
    const user = await createUserViaApi(request, 'delpatch')
    await deleteUserViaApi(request, user.id)

    const res = await request.patch(`/api/users/${user.id}`, {
      data: { name: 'Back from the dead', email: user.email },
    })
    expect(res.status()).toBe(404)
    expect(await res.json()).toEqual({ error: 'User not found' })
  })

  test("unassigns every ticket of the deleted agent, whatever its status; other agents' tickets stay", async ({
    request,
  }) => {
    await signInViaApi(request, ADMIN)
    const leaving = await createUserViaApi(request, 'delassignee')
    const staying = await createUserViaApi(request, 'delother')
    const open = await createTicketViaWebhook(request, 'del-unassign-open')
    const resolved = await createTicketViaWebhook(request, 'del-unassign-resolved')
    const others = await createTicketViaWebhook(request, 'del-unassign-other')
    await updateTicketViaApi(request, open.id, { assignedToId: leaving.id })
    await updateTicketViaApi(request, resolved.id, { assignedToId: leaving.id, status: 'resolved' })
    await updateTicketViaApi(request, others.id, { assignedToId: staying.id })
    expect(await getTicket(request, resolved.id)).toMatchObject({
      status: 'resolved',
      assignedTo: { id: leaving.id, name: leaving.name },
    })

    const res = await request.delete(`/api/users/${leaving.id}`)
    expect(res.status()).toBe(204)
    expect(await res.text()).toBe('')

    expect(await getTicket(request, open.id)).toMatchObject({ status: 'open', assignedTo: null })
    expect(await getTicket(request, resolved.id)).toMatchObject({ status: 'resolved', assignedTo: null })
    expect(await getTicket(request, others.id)).toMatchObject({
      status: 'open',
      assignedTo: { id: staying.id, name: staying.name },
    })
  })

  test('deleting an agent who holds no tickets still gets 204', async ({ request }) => {
    await signInViaApi(request, ADMIN)
    const user = await createUserViaApi(request, 'delnotickets')

    const res = await request.delete(`/api/users/${user.id}`)
    expect(res.status()).toBe(204)
    expect(await res.text()).toBe('')
    const { users } = await (await request.get('/api/users')).json()
    expect(users.map((u: { id: string }) => u.id)).not.toContain(user.id)
  })

  test("POST with a deleted user's email gets 409; the email stays reserved", async ({ request }) => {
    await signInViaApi(request, ADMIN)
    const user = await createUserViaApi(request, 'delreuse')
    await deleteUserViaApi(request, user.id)

    const res = await request.post('/api/users', {
      data: { name: 'Replacement user', email: user.email, password: `pw-${uniqueSuffix()}` },
    })
    expect(res.status()).toBe(409)
    expect(await res.json()).toEqual({ error: 'A user with this email already exists' })
    const { users } = await (await request.get('/api/users')).json()
    expect(users.map((u: { email: string }) => u.email)).not.toContain(user.email)
  })
})
