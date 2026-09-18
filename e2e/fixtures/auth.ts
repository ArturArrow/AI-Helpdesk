import { expect, type APIRequestContext, type Page } from '@playwright/test'

export type Credentials = { email: string; password: string; name: string }

// Matches ADMIN_* in server/.env.test (seeded by global-setup via prisma/seed.ts).
export const ADMIN: Credentials = {
  email: 'admin@example.com',
  password: 'test-admin-password',
  name: 'Admin',
}

// Created by global-setup via e2e/seed-agent.ts (Better Auth's internalAdapter, like the seed).
export const AGENT: Credentials = {
  email: 'agent@example.com',
  password: 'test-agent-password',
  name: 'Agent',
}

// Better Auth checks Origin on cookie-bearing POSTs; the browser sends it, APIRequestContext doesn't.
export const ORIGIN = 'http://localhost:5174'

// Signs in through the API. With `page.request` the session cookie lands in the browser context.
export async function signInViaApi(request: APIRequestContext, user: Credentials) {
  const res = await request.post('/api/auth/sign-in/email', {
    headers: { Origin: ORIGIN },
    data: { email: user.email, password: user.password },
  })
  expect(res.status(), `sign-in as ${user.email}`).toBe(200)
}

// Fills and submits the login form on the current page; asserts nothing about the outcome.
// Takes raw strings so tests can submit invalid or wrong input.
export async function submitLoginForm(page: Page, email: string, password: string) {
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

// Signs in through the login page and waits for the redirect to /.
export async function signInViaUi(page: Page, user: Credentials) {
  await page.goto('/login')
  await submitLoginForm(page, user.email, user.password)
  await expect(page).toHaveURL('/')
}

// Clicks Sign out in the navbar and waits for the redirect to /login.
export async function signOutViaUi(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL('/login')
}

// Visits `path` and asserts the app bounces to /login.
export async function expectRedirectToLogin(page: Page, path: string) {
  await page.goto(path)
  await expect(page).toHaveURL('/login')
}
