import { expect, test } from '@playwright/test'
import { ADMIN, expectRedirectToLogin, signInViaUi, submitLoginForm } from '../fixtures/auth.js'

test.describe('login: happy path', () => {
  test('admin signs in, lands on / and sees the navbar with the Users link', async ({ page }) => {
    await signInViaUi(page, ADMIN)

    await expect(page.getByRole('heading', { name: `Welcome, ${ADMIN.name}` })).toBeVisible()
    const nav = page.getByRole('navigation')
    await expect(nav.getByRole('link', { name: 'Helpdesk' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Users' })).toBeVisible()
    await expect(nav.getByText(ADMIN.name, { exact: true })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Sign out' })).toBeVisible()
  })

  test('email is matched case-insensitively', async ({ page }) => {
    await signInViaUi(page, { ...ADMIN, email: ADMIN.email.toUpperCase() })

    await expect(page.getByRole('heading', { name: `Welcome, ${ADMIN.name}` })).toBeVisible()
  })
})

test.describe('login: server rejection', () => {
  test('wrong password shows an error and stays on /login', async ({ page }) => {
    await page.goto('/login')
    await submitLoginForm(page, ADMIN.email, 'definitely-wrong-password')

    await expect(page.getByRole('alert')).toContainText('Invalid email or password')
    await expect(page).toHaveURL('/login')
    await expect(page.getByRole('navigation')).toHaveCount(0)
  })

  test('correct email in a different case with a wrong password is still rejected', async ({
    page,
  }) => {
    await page.goto('/login')
    await submitLoginForm(page, ADMIN.email.toUpperCase(), 'definitely-wrong-password')

    await expect(page.getByRole('alert')).toContainText('Invalid email or password')
    await expect(page).toHaveURL('/login')
  })

  test('password is case-sensitive', async ({ page }) => {
    await page.goto('/login')
    await submitLoginForm(page, ADMIN.email, ADMIN.password.toUpperCase())

    await expect(page.getByRole('alert')).toContainText('Invalid email or password')
    await expect(page).toHaveURL('/login')
  })

  test('a failed attempt sets no session', async ({ page }) => {
    await page.goto('/login')
    await submitLoginForm(page, ADMIN.email, 'definitely-wrong-password')
    await expect(page.getByRole('alert')).toContainText('Invalid email or password')

    expect((await page.request.get('/api/me')).status()).toBe(401)
    await expectRedirectToLogin(page, '/')
  })
})
