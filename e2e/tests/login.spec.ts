import { expect, test, type Page } from '@playwright/test'
import { ADMIN, AGENT, expectRedirectToLogin, signInViaUi, submitLoginForm } from '../fixtures/auth.js'

// Records every sign-in request the page sends, to prove client validation blocks submission.
function trackSignInRequests(page: Page) {
  const urls: string[] = []
  page.on('request', (req) => {
    if (req.url().includes('/api/auth/sign-in')) urls.push(req.url())
  })
  return urls
}

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

  test('agent signs in, lands on / and sees the navbar without the Users link', async ({ page }) => {
    await signInViaUi(page, AGENT)

    await expect(page.getByRole('heading', { name: `Welcome, ${AGENT.name}` })).toBeVisible()
    const nav = page.getByRole('navigation')
    await expect(nav.getByText(AGENT.name, { exact: true })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Sign out' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Users' })).toHaveCount(0)
  })

  test('email is matched case-insensitively', async ({ page }) => {
    await signInViaUi(page, { ...ADMIN, email: ADMIN.email.toUpperCase() })

    await expect(page.getByRole('heading', { name: `Welcome, ${ADMIN.name}` })).toBeVisible()
  })

  test('the submit button is disabled and shows progress while the request is in flight', async ({
    page,
  }) => {
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    await page.route('**/api/auth/sign-in/email', async (route) => {
      await held
      await route.continue()
    })

    await page.goto('/login')
    await submitLoginForm(page, ADMIN.email, ADMIN.password)

    const pending = page.getByRole('button', { name: 'Signing in…' })
    await expect(pending).toBeVisible()
    await expect(pending).toBeDisabled()

    release()
    await expect(page).toHaveURL('/')
  })
})

test.describe('login: client-side validation', () => {
  test('empty form shows both field errors and sends no request', async ({ page }) => {
    const requests = trackSignInRequests(page)
    await page.goto('/login')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.getByRole('alert').filter({ hasText: 'Enter a valid email address' })).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: 'Password is required' })).toBeVisible()
    await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByLabel('Password')).toHaveAttribute('aria-invalid', 'true')
    await expect(page).toHaveURL('/login')
    expect(requests).toEqual([])
  })

  for (const email of ['not-an-email', 'missing-domain@', '@example.com', 'a b@example.com']) {
    test(`malformed email "${email}" is rejected before any request`, async ({ page }) => {
      const requests = trackSignInRequests(page)
      await page.goto('/login')
      await submitLoginForm(page, email, 'whatever-password')

      await expect(page.getByRole('alert')).toHaveText('Enter a valid email address')
      await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true')
      await expect(page.getByLabel('Password')).toHaveAttribute('aria-invalid', 'false')
      await expect(page).toHaveURL('/login')
      expect(requests).toEqual([])
    })
  }

  test('valid email with empty password shows only the password error', async ({ page }) => {
    const requests = trackSignInRequests(page)
    await page.goto('/login')
    await page.getByLabel('Email').fill(ADMIN.email)
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.getByRole('alert')).toHaveText('Password is required')
    await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'false')
    await expect(page.getByLabel('Password')).toHaveAttribute('aria-invalid', 'true')
    expect(requests).toEqual([])
  })

  test('field errors clear once the input is corrected, then sign-in succeeds', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('alert')).toHaveCount(2)

    await page.getByLabel('Email').fill(ADMIN.email)
    await expect(page.getByRole('alert')).toHaveText('Password is required')
    await page.getByLabel('Password').fill(ADMIN.password)
    await expect(page.getByRole('alert')).toHaveCount(0)

    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL('/')
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

  test('unknown email shows the same error as a wrong password', async ({ page }) => {
    await page.goto('/login')
    await submitLoginForm(page, `nobody-${Date.now()}@example.com`, 'some-password')

    await expect(page.getByRole('alert')).toContainText('Invalid email or password')
    await expect(page).toHaveURL('/login')
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

  test('after a failed attempt the user can retry and sign in', async ({ page }) => {
    await page.goto('/login')
    await submitLoginForm(page, ADMIN.email, 'definitely-wrong-password')
    await expect(page.getByRole('alert')).toContainText('Invalid email or password')

    await page.getByLabel('Password').fill(ADMIN.password)
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page).toHaveURL('/')
    await expect(page.getByRole('heading', { name: `Welcome, ${ADMIN.name}` })).toBeVisible()
  })

  test('a failed attempt sets no session', async ({ page }) => {
    await page.goto('/login')
    await submitLoginForm(page, ADMIN.email, 'definitely-wrong-password')
    await expect(page.getByRole('alert')).toContainText('Invalid email or password')

    expect((await page.request.get('/api/me')).status()).toBe(401)
    await expectRedirectToLogin(page, '/')
  })
})
