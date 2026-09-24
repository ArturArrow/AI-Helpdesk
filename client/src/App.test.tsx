import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axios from 'axios'
import { Role } from 'core/constants/role'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '@/test/render.tsx'
import { mockSession } from '@/test/session.ts'
import App from './App.tsx'

vi.mock('@/lib/auth-client.ts', () => ({
  authClient: { useSession: vi.fn(), signIn: { email: vi.fn() }, signOut: vi.fn() },
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

async function expectLoginPage() {
  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  expect(screen.getByLabelText('Email')).toBeInTheDocument()
}

describe('App routing', () => {
  describe('without a session', () => {
    it.each(['/', '/tickets', '/users', '/no-such-page'])('sends %s to the login page', async (route) => {
      mockSession(null)
      renderWithRouter(<App />, route)

      await expectLoginPage()
      expect(screen.queryByRole('heading', { name: /Welcome/ })).not.toBeInTheDocument()
    })
  })

  it('shows a busy skeleton, not the login form, while the session is loading', () => {
    mockSession(null, { isPending: true })
    renderWithRouter(<App />, '/')

    // The skeleton wrapper has no role or name; aria-busy is what marks it for assistive tech.
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Welcome/ })).not.toBeInTheDocument()
  })

  it('sends an unknown path to the home page when signed in', async () => {
    mockSession({ name: 'Alan Agent', role: Role.agent })
    renderWithRouter(<App />, '/no-such-page')

    expect(await screen.findByRole('heading', { name: 'Welcome, Alan Agent' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('sends an agent from /users to the home page, with no Users link', async () => {
    const get = vi.spyOn(axios, 'get').mockResolvedValue({ data: { users: [] } })
    mockSession({ name: 'Alan Agent', role: Role.agent })
    renderWithRouter(<App />, '/users')

    expect(await screen.findByRole('heading', { name: 'Welcome, Alan Agent' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Users' })).not.toBeInTheDocument()
    expect(get).not.toHaveBeenCalled()
  })

  it('shows the Users page to an admin on /users', async () => {
    const get = vi.spyOn(axios, 'get').mockResolvedValue({
      data: {
        users: [
          {
            id: '1',
            name: 'Ada Admin',
            email: 'admin@example.com',
            role: Role.admin,
            createdAt: '2026-01-15T12:00:00.000Z',
          },
        ],
      },
    })
    mockSession({ name: 'Ada Admin', role: Role.admin })
    renderWithRouter(<App />, '/users')

    expect(screen.getByRole('heading', { name: 'Users' })).toBeInTheDocument()
    expect(await screen.findByRole('cell', { name: 'admin@example.com' })).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/api/users')
    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('href', '/users')
    expect(screen.queryByRole('heading', { name: /Welcome/ })).not.toBeInTheDocument()
  })

  it.each([
    { name: 'Alan Agent', role: Role.agent },
    { name: 'Ada Admin', role: Role.admin },
  ])('takes $role from the Tickets link to the Tickets page', async (sessionUser) => {
    const user = userEvent.setup()
    const get = vi.spyOn(axios, 'get').mockResolvedValue({ data: { tickets: [] } })
    mockSession(sessionUser)
    renderWithRouter(<App />, '/')
    expect(await screen.findByRole('heading', { name: `Welcome, ${sessionUser.name}` })).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Tickets' }))

    expect(await screen.findByRole('heading', { name: 'Tickets', level: 1 })).toBeInTheDocument()
    expect(await screen.findByText('No tickets yet.')).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/api/tickets')
    expect(screen.queryByRole('heading', { name: /Welcome/ })).not.toBeInTheDocument()
  })
})
