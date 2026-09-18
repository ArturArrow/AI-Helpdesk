import { expect, test } from '@playwright/test'
import {
  ADMIN,
  AGENT,
  ORIGIN,
  expectRedirectToLogin,
  signInViaApi,
  signInViaUi,
  signOutViaUi,
} from '../fixtures/auth.js'

test.describe('session persistence', () => {
  test('survives a reload', async ({ page }) => {
    await signInViaApi(page.request, ADMIN)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: `Welcome, ${ADMIN.name}` })).toBeVisible()

    await page.reload()
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('heading', { name: `Welcome, ${ADMIN.name}` })).toBeVisible()
  })

  test('a UI sign-in is shared with a new page in the same context', async ({ page, context }) => {
    await signInViaUi(page, AGENT)

    const second = await context.newPage()
    await second.goto('/')
    await expect(second).toHaveURL('/')
    await expect(second.getByRole('heading', { name: `Welcome, ${AGENT.name}` })).toBeVisible()
  })

  test('a fresh browser context is unauthenticated', async ({ page, browser, baseURL }) => {
    await signInViaApi(page.request, ADMIN)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: `Welcome, ${ADMIN.name}` })).toBeVisible()

    const fresh = await browser.newContext({ baseURL })
    try {
      const other = await fresh.newPage()
      await expectRedirectToLogin(other, '/')
      expect((await other.request.get('/api/me')).status()).toBe(401)
    } finally {
      await fresh.close()
    }
  })
})

test.describe('logout', () => {
  test('signing out redirects to /login and protected routes redirect again', async ({ page }) => {
    await signInViaApi(page.request, ADMIN)
    await page.goto('/')
    await signOutViaUi(page)
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()

    await expectRedirectToLogin(page, '/')
    await expectRedirectToLogin(page, '/users')
    expect((await page.request.get('/api/me')).status()).toBe(401)
  })

  test('the back button does not show protected content after sign-out', async ({ page }) => {
    await signInViaApi(page.request, ADMIN)
    await page.goto('/')
    await page.getByRole('link', { name: 'Users' }).click()
    await expect(page).toHaveURL('/users')
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()

    // History is now [/, /users]; sign-out replaces /users with /login.
    await signOutViaUi(page)

    await page.goBack()
    await expect(page).toHaveURL('/login')
    await expect(page.getByRole('heading', { name: /Welcome/ })).toHaveCount(0)
    await expect(page.getByRole('navigation')).toHaveCount(0)
  })

  test('sign-out revokes the session on the server, not just the cookie', async ({
    playwright,
    baseURL,
  }) => {
    const api = await playwright.request.newContext({ baseURL })
    await signInViaApi(api, AGENT)
    const stolen = await api.storageState()

    const out = await api.post('/api/auth/sign-out', { headers: { Origin: ORIGIN } })
    expect(out.status()).toBe(200)
    await api.dispose()

    // Replaying the pre-logout cookie must not authenticate.
    const replay = await playwright.request.newContext({ baseURL, storageState: stolen })
    try {
      expect((await replay.get('/api/me')).status()).toBe(401)
    } finally {
      await replay.dispose()
    }
  })

  test('signing out one context leaves another session of the same user signed in', async ({
    page,
    playwright,
    baseURL,
  }) => {
    const other = await playwright.request.newContext({ baseURL })
    try {
      await signInViaApi(other, ADMIN)
      await signInViaApi(page.request, ADMIN)
      await page.goto('/')
      await signOutViaUi(page)

      expect((await other.get('/api/me')).status()).toBe(200)
    } finally {
      await other.dispose()
    }
  })
})
