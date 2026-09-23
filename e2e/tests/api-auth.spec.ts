import { expect, test } from '@playwright/test'
import { ADMIN, AGENT, ORIGIN, signInViaApi } from '../fixtures/auth.js'

// Each test gets a fresh `request` context with its own cookie jar.

test.describe('GET /api/me', () => {
  test('401 without a session', async ({ request }) => {
    const res = await request.get('/api/me')
    expect(res.status()).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  test('401 with a forged session cookie', async ({ request }) => {
    const res = await request.get('/api/me', {
      headers: { Cookie: 'better-auth.session_token=forged.value' },
    })
    expect(res.status()).toBe(401)
  })

  for (const [user, role] of [
    [ADMIN, 'admin'],
    [AGENT, 'agent'],
  ] as const) {
    test(`200 with the user and role "${role}" when signed in`, async ({ request }) => {
      await signInViaApi(request, user)
      const res = await request.get('/api/me')
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.user).toMatchObject({ email: user.email, name: user.name, role })
      expect(body.user).not.toHaveProperty('password')
    })
  }
})

test.describe('POST /api/auth/sign-in/email', () => {
  test('wrong password and unknown email get the same 401', async ({ request }) => {
    const wrong = await request.post('/api/auth/sign-in/email', {
      data: { email: ADMIN.email, password: 'definitely-wrong-password' },
    })
    const unknown = await request.post('/api/auth/sign-in/email', {
      data: { email: `nobody-${Date.now()}@example.com`, password: 'definitely-wrong-password' },
    })
    expect(wrong.status()).toBe(401)
    expect(unknown.status()).toBe(401)
    expect((await wrong.json()).message).toBe((await unknown.json()).message)
    expect((await request.get('/api/me')).status()).toBe(401)
  })
})

test.describe('/api/users guard', () => {
  // The admin passes the guard: GET lists, POST rejects the password-less body (400), PATCH
  // finds no such user (404), and the unrouted GET/DELETE by id fall through to a 404.
  for (const [method, path, adminStatus] of [
    ['GET', '/api/users', 200],
    ['GET', '/api/users/some-id', 404],
    ['POST', '/api/users', 400],
    ['PATCH', '/api/users/some-id', 404],
    ['DELETE', '/api/users/some-id', 404],
  ] as const) {
    test(`${method} ${path}: 401 unauthenticated, 403 agent, ${adminStatus} admin`, async ({
      playwright,
      baseURL,
    }) => {
      const anon = await playwright.request.newContext({ baseURL })
      const agent = await playwright.request.newContext({ baseURL })
      const admin = await playwright.request.newContext({ baseURL })
      try {
        await signInViaApi(agent, AGENT)
        await signInViaApi(admin, ADMIN)
        const call = (ctx: typeof anon) =>
          ctx.fetch(path, {
            method,
            data: method === 'POST' || method === 'PATCH' ? { name: 'Nobody', email: 'x@example.com' } : undefined,
          })

        const a = await call(anon)
        expect(a.status()).toBe(401)
        expect(await a.json()).toEqual({ error: 'Unauthorized' })

        const g = await call(agent)
        expect(g.status()).toBe(403)
        expect(await g.json()).toEqual({ error: 'Forbidden' })

        const d = await call(admin)
        expect(d.status()).toBe(adminStatus)
      } finally {
        await Promise.all([anon.dispose(), agent.dispose(), admin.dispose()])
      }
    })
  }
})

test.describe('public sign-up is disabled', () => {
  test('POST /api/auth/sign-up/email is refused and creates no account', async ({ request }) => {
    const email = `signup-${Date.now()}@example.com`
    const password = 'a-long-enough-password'

    const res = await request.post('/api/auth/sign-up/email', {
      headers: { Origin: ORIGIN },
      data: { email, password, name: 'Intruder' },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).code).toBe('EMAIL_PASSWORD_SIGN_UP_DISABLED')
    expect((await request.get('/api/me')).status()).toBe(401)

    const signInAttempt = await request.post('/api/auth/sign-in/email', {
      data: { email, password },
    })
    expect(signInAttempt.status()).toBe(401)
  })

  test('sign-up with role "admin" in the payload is refused too', async ({ request }) => {
    const email = `signup-admin-${Date.now()}@example.com`
    const password = 'a-long-enough-password'

    const res = await request.post('/api/auth/sign-up/email', {
      headers: { Origin: ORIGIN },
      data: { email, password, name: 'Intruder', role: 'admin' },
    })
    expect(res.ok()).toBe(false)
    expect((await request.get('/api/me')).status()).toBe(401)
    expect(
      (await request.post('/api/auth/sign-in/email', { data: { email, password } })).status(),
    ).toBe(401)
  })
})

test.describe('role is server-owned', () => {
  test('an agent cannot promote itself through /api/auth/update-user', async ({ request }) => {
    await signInViaApi(request, AGENT)

    const res = await request.post('/api/auth/update-user', {
      headers: { Origin: ORIGIN },
      data: { role: 'admin' },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).message).toBe('role is not allowed to be set')

    const me = await (await request.get('/api/me')).json()
    expect(me.user.role).toBe('agent')
    expect((await request.get('/api/users')).status()).toBe(403)
  })

  test('role smuggled next to a legitimate field is refused as a whole', async ({ request }) => {
    await signInViaApi(request, AGENT)

    const res = await request.post('/api/auth/update-user', {
      headers: { Origin: ORIGIN },
      data: { name: AGENT.name, role: 'admin' },
    })
    expect(res.status()).toBe(400)

    const me = await (await request.get('/api/me')).json()
    expect(me.user).toMatchObject({ role: 'agent', name: AGENT.name })
  })
})

test.describe('error responses', () => {
  for (const [label, signedIn] of [
    ['unauthenticated', false],
    ['as admin', true],
  ] as const) {
    test(`malformed JSON gets a JSON 400, not an HTML stack trace (${label})`, async ({
      request,
    }) => {
      if (signedIn) await signInViaApi(request, ADMIN)

      const res = await request.post('/api/users', {
        headers: { 'Content-Type': 'application/json' },
        data: '{"email": "broken',
      })
      expect(res.status()).toBe(400)
      expect(res.headers()['content-type']).toContain('application/json')
      const text = await res.text()
      expect(text).not.toContain('<')
      expect(text).not.toMatch(/\bat \S+ \(/) // no stack frames
      expect(JSON.parse(text)).toEqual({ error: expect.any(String) })
    })
  }
})
