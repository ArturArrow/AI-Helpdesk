import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axios from 'axios'
import { Role } from 'core/constants/role'
import { TicketStatus } from 'core/constants/ticketStatus'
import { DEFAULT_TICKET_PAGE_SIZE } from 'core/schemas/tickets'
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

const ticket = {
  id: 7,
  subject: 'Printer on fire',
  senderName: 'Pat Printer',
  senderEmail: 'pat@example.com',
  status: TicketStatus.open,
  category: null,
  createdAt: '2026-04-04T09:30:00.000Z',
  updatedAt: '2026-04-04T09:30:00.000Z',
  body: 'It is on fire.',
  bodyHTML: null,
  assignedTo: null,
}

const stats = { total: 3, open: 2, resolvedByAi: 1, averageResolutionMs: null, ticketsPerDay: [] }
// The dashboard sends the viewer's time zone, resolved the same way.
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone

async function expectLoginPage() {
  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  expect(screen.getByLabelText('Email')).toBeInTheDocument()
}

describe('App routing', () => {
  describe('without a session', () => {
    it.each(['/', '/tickets', '/tickets/7', '/users', '/no-such-page'])('sends %s to the login page', async (route) => {
      mockSession(null)
      renderWithRouter(<App />, route)

      await expectLoginPage()
      expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument()
    })
  })

  it('shows a busy skeleton, not the login form, while the session is loading', () => {
    mockSession(null, { isPending: true })
    renderWithRouter(<App />, '/')

    // The skeleton wrapper has no role or name; aria-busy is what marks it for assistive tech.
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument()
  })

  it('sends an unknown path to the dashboard when signed in', async () => {
    const get = vi.spyOn(axios, 'get').mockResolvedValue({ data: stats })
    mockSession({ name: 'Alan Agent', role: Role.agent })
    renderWithRouter(<App />, '/no-such-page')

    expect(await screen.findByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/api/tickets/stats', { params: { period: 'all', tz } })
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('sends an agent from /users to the dashboard, with no Users link', async () => {
    const get = vi.spyOn(axios, 'get').mockImplementation(async (url: string) =>
      url === '/api/tickets/stats' ? { data: stats } : { data: { users: [] } },
    )
    mockSession({ name: 'Alan Agent', role: Role.agent })
    renderWithRouter(<App />, '/users')

    expect(await screen.findByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Users' })).not.toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/api/tickets/stats', { params: { period: 'all', tz } })
    expect(get).not.toHaveBeenCalledWith('/api/users')
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
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument()
  })

  it.each([
    { name: 'Alan Agent', role: Role.agent },
    { name: 'Ada Admin', role: Role.admin },
  ])('takes $role from the Tickets link to the Tickets page', async (sessionUser) => {
    const user = userEvent.setup()
    const get = vi.spyOn(axios, 'get').mockImplementation(async (url: string) =>
      url === '/api/tickets/stats' ? { data: stats } : { data: { tickets: [], total: 0 } },
    )
    mockSession(sessionUser)
    renderWithRouter(<App />, '/')
    expect(await screen.findByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Tickets' }))

    expect(await screen.findByRole('heading', { name: 'Tickets', level: 1 })).toBeInTheDocument()
    expect(await screen.findByText('No tickets yet.')).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/api/tickets', { params: { sortBy: 'createdAt', sortOrder: 'desc', page: 1, pageSize: DEFAULT_TICKET_PAGE_SIZE } })
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument()
  })

  it.each([
    { name: 'Alan Agent', role: Role.agent },
    { name: 'Ada Admin', role: Role.admin },
  ])('shows the ticket detail page to $role on /tickets/:id', async (sessionUser) => {
    const get = vi.spyOn(axios, 'get').mockResolvedValue({ data: { ticket } })
    mockSession(sessionUser)
    renderWithRouter(<App />, '/tickets/7')

    expect(await screen.findByRole('heading', { name: 'Printer on fire', level: 1 })).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/api/tickets/7')
    expect(screen.getByRole('link', { name: 'Tickets' })).toHaveAttribute('href', '/tickets')
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument()
  })

  it('goes from the list to a ticket and back to the same list URL', async () => {
    const user = userEvent.setup()
    const get = vi.spyOn(axios, 'get').mockImplementation(async (url: string) =>
      url === '/api/tickets' ? { data: { tickets: [ticket], total: 1 } } : { data: { ticket } },
    )
    mockSession({ name: 'Alan Agent', role: Role.agent })
    renderWithRouter(<App />, '/tickets?status=open&sortBy=subject&sortOrder=asc')

    await user.click(await screen.findByRole('link', { name: 'Printer on fire' }))
    expect(await screen.findByRole('heading', { name: 'Printer on fire', level: 1 })).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/api/tickets/7')

    await user.click(screen.getByRole('link', { name: 'Back to tickets' }))
    expect(await screen.findByRole('heading', { name: 'Tickets', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Filter by status' })).toHaveTextContent('Open')
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith('/api/tickets', {
        params: { sortBy: 'subject', sortOrder: 'asc', status: 'open', page: 1, pageSize: DEFAULT_TICKET_PAGE_SIZE },
      }),
    )
  })
})
