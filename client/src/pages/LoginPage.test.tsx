import { screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { Role } from 'core/constants/role'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { authClient } from '@/lib/auth-client.ts'
import { renderWithRouter } from '@/test/render.tsx'
import { mockSession } from '@/test/session.ts'
import LoginPage from './LoginPage.tsx'

vi.mock('@/lib/auth-client.ts', () => ({
  authClient: { useSession: vi.fn(), signIn: { email: vi.fn() } },
}))

afterEach(() => {
  vi.resetAllMocks()
})

// /login plus a stand-in home page, so a navigation to / shows up.
function renderLogin() {
  const user = userEvent.setup()
  renderWithRouter(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<h1>Home page</h1>} />
    </Routes>,
    '/login',
  )
  return user
}

function emailInput() {
  return screen.getByLabelText('Email')
}

function passwordInput() {
  return screen.getByLabelText('Password')
}

function alertTexts() {
  return screen.queryAllByRole('alert').map((el) => el.textContent)
}

async function submit(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

async function signIn(user: UserEvent, email: string, password: string) {
  await user.type(emailInput(), email)
  await user.type(passwordInput(), password)
  await submit(user)
}

describe('LoginPage', () => {
  describe('validation', () => {
    it('flags both fields on an empty submit and does not sign in', async () => {
      mockSession(null)
      const user = renderLogin()

      await submit(user)

      expect(alertTexts()).toEqual(['Enter a valid email address', 'Password is required'])
      expect(emailInput()).toHaveAttribute('aria-invalid', 'true')
      expect(passwordInput()).toHaveAttribute('aria-invalid', 'true')
      expect(authClient.signIn.email).not.toHaveBeenCalled()
    })

    it.each(['not-an-email', 'missing-domain@', '@example.com', 'a b@example.com'])(
      'rejects the malformed email %j',
      async (email) => {
        mockSession(null)
        const user = renderLogin()

        await signIn(user, email, 'secret123')

        expect(alertTexts()).toEqual(['Enter a valid email address'])
        expect(emailInput()).toHaveAttribute('aria-invalid', 'true')
        expect(passwordInput()).toHaveAttribute('aria-invalid', 'false')
        expect(authClient.signIn.email).not.toHaveBeenCalled()
      },
    )

    it('flags only the password when the email is valid', async () => {
      mockSession(null)
      const user = renderLogin()

      await user.type(emailInput(), 'agent@example.com')
      await submit(user)

      expect(alertTexts()).toEqual(['Password is required'])
      expect(emailInput()).toHaveAttribute('aria-invalid', 'false')
      expect(passwordInput()).toHaveAttribute('aria-invalid', 'true')
      expect(authClient.signIn.email).not.toHaveBeenCalled()
    })

    it('clears each error as its field is corrected', async () => {
      mockSession(null)
      const user = renderLogin()
      await submit(user)

      await user.type(emailInput(), 'agent@example.com')
      expect(alertTexts()).toEqual(['Password is required'])
      expect(emailInput()).toHaveAttribute('aria-invalid', 'false')

      await user.type(passwordInput(), 'secret123')
      expect(alertTexts()).toEqual([])
      expect(passwordInput()).toHaveAttribute('aria-invalid', 'false')
    })
  })

  describe('signing in', () => {
    it('disables the button and shows progress while the request is pending', async () => {
      mockSession(null)
      vi.mocked(authClient.signIn.email).mockReturnValue(new Promise(() => {}))
      const user = renderLogin()

      await signIn(user, 'agent@example.com', 'secret123')

      const button = await screen.findByRole('button', { name: 'Signing in…' })
      expect(button).toBeDisabled()
    })

    it('sends the credentials and navigates home on success', async () => {
      mockSession(null)
      vi.mocked(authClient.signIn.email).mockResolvedValue({ data: {}, error: null })
      const user = renderLogin()

      await signIn(user, 'agent@example.com', 'secret123')

      expect(await screen.findByRole('heading', { name: 'Home page' })).toBeInTheDocument()
      expect(authClient.signIn.email).toHaveBeenCalledWith({
        email: 'agent@example.com',
        password: 'secret123',
      })
    })

    it('shows the server message and stays on the form when sign-in fails', async () => {
      mockSession(null)
      vi.mocked(authClient.signIn.email).mockResolvedValue({
        data: null,
        error: { status: 401, statusText: 'Unauthorized', message: 'Invalid email or password' },
      })
      const user = renderLogin()

      await signIn(user, 'agent@example.com', 'wrong-password')

      expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password')
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
      expect(screen.queryByRole('heading', { name: 'Home page' })).not.toBeInTheDocument()
    })

    it('falls back to a generic message when the error has none', async () => {
      mockSession(null)
      vi.mocked(authClient.signIn.email).mockResolvedValue({
        data: null,
        error: { status: 401, statusText: 'Unauthorized' },
      })
      const user = renderLogin()

      await signIn(user, 'agent@example.com', 'wrong-password')

      expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password')
      expect(screen.queryByRole('heading', { name: 'Home page' })).not.toBeInTheDocument()
    })

    it('navigates home when a retry after a failure succeeds', async () => {
      mockSession(null)
      vi.mocked(authClient.signIn.email)
        .mockResolvedValueOnce({
          data: null,
          error: { status: 401, statusText: 'Unauthorized', message: 'Invalid email or password' },
        })
        .mockResolvedValueOnce({ data: {}, error: null })
      const user = renderLogin()

      await signIn(user, 'agent@example.com', 'wrong-password')
      await screen.findByRole('alert')

      await user.clear(passwordInput())
      await user.type(passwordInput(), 'secret123')
      await submit(user)

      expect(await screen.findByRole('heading', { name: 'Home page' })).toBeInTheDocument()
      expect(authClient.signIn.email).toHaveBeenCalledTimes(2)
      expect(authClient.signIn.email).toHaveBeenLastCalledWith({
        email: 'agent@example.com',
        password: 'secret123',
      })
    })
  })

  it('redirects to / when a session already exists', async () => {
    mockSession({ name: 'Alan Agent', role: Role.agent })
    renderLogin()

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Home page' })).toBeInTheDocument())
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
  })
})
