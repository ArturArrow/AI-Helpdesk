import { expect, test } from '@playwright/test'
import {
  ADMIN,
  AGENT,
  expectRedirectToLogin,
  signInViaApi,
  submitLoginForm,
} from '../fixtures/auth.js'

test.describe('protected routes (unauthenticated)', () => {
  test('visiting / redirects to /login', async ({ page }) => {
    await expectRedirectToLogin(page, '/')
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
    await expect(page.getByRole('navigation')).toHaveCount(0)
  })

  test('after being bounced from a deep link, signing in lands on / (no return-to)', async ({
    page,
  }) => {
    await expectRedirectToLogin(page, '/users')

    await submitLoginForm(page, ADMIN.email, ADMIN.password)

    await expect(page).toHaveURL('/')
    await expect(page.getByRole('heading', { name: `Welcome, ${ADMIN.name}` })).toBeVisible()
  })
})

test.describe('role gating', () => {
  test('admin sees the Users link and can open /users from it', async ({ page }) => {
    await signInViaApi(page.request, ADMIN)
    await page.goto('/')

    await page.getByRole('navigation').getByRole('link', { name: 'Users' }).click()
    await expect(page).toHaveURL('/users')
    await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible()
  })

  test('agent has no Users link and is redirected from /users to /', async ({ page }) => {
    await signInViaApi(page.request, AGENT)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: `Welcome, ${AGENT.name}` })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0)

    await page.goto('/users')
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('heading', { name: `Welcome, ${AGENT.name}` })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toHaveCount(0)
  })

  test('agent is also refused by the server, not just the page', async ({ page }) => {
    await signInViaApi(page.request, AGENT)
    const res = await page.request.get('/api/users')
    expect(res.status()).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
  })
})
