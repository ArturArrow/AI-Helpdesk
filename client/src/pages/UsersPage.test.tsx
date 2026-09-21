import { screen, within } from '@testing-library/react'
import axios, { AxiosError, type AxiosResponse } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '@/test/render.tsx'
import UsersPage from './UsersPage.tsx'

const users = [
  {
    id: '1',
    name: 'Ada Admin',
    email: 'admin@example.com',
    role: 'admin',
    createdAt: '2026-01-15T12:00:00.000Z',
  },
  {
    id: '2',
    name: 'Alan Agent',
    email: 'agent@example.com',
    role: 'agent',
    createdAt: '2026-03-02T12:00:00.000Z',
  },
]

function mockGet() {
  return vi.spyOn(axios, 'get')
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('UsersPage', () => {
  it('shows skeleton rows while the request is pending', () => {
    mockGet().mockReturnValue(new Promise(() => {}))
    renderWithQuery(<UsersPage />)

    const table = screen.getByRole('table')
    expect(table).toHaveAttribute('aria-busy', 'true')
    // Header row plus three placeholder rows, none of them holding text.
    const [, ...bodyRows] = within(table).getAllByRole('row')
    expect(bodyRows).toHaveLength(3)
    for (const row of bodyRows) expect(row.textContent).toBe('')
  })

  it('lists users from GET /api/users', async () => {
    const get = mockGet().mockResolvedValue({ data: { users } })
    renderWithQuery(<UsersPage />)

    expect(await screen.findByRole('cell', { name: 'Ada Admin' })).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/api/users')

    const table = screen.getByRole('table')
    expect(table).toHaveAttribute('aria-busy', 'false')
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Name',
      'Email',
      'Role',
      'Created',
    ])

    const [, ...bodyRows] = within(table).getAllByRole('row')
    expect(bodyRows.map((row) => within(row).getAllByRole('cell').map((td) => td.textContent))).toEqual(
      users.map((u) => [u.name, u.email, u.role, new Date(u.createdAt).toLocaleDateString()]),
    )
  })

  it('shows an empty state instead of the table when there are no users', async () => {
    mockGet().mockResolvedValue({ data: { users: [] } })
    renderWithQuery(<UsersPage />)

    expect(await screen.findByText('No users yet.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows the HTTP status when the request fails', async () => {
    mockGet().mockRejectedValue(
      new AxiosError('Request failed with status code 403', 'ERR_BAD_REQUEST', undefined, undefined, {
        status: 403,
      } as AxiosResponse),
    )
    renderWithQuery(<UsersPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load users: Request failed (403)")
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows a generic message when the request fails without a response', async () => {
    mockGet().mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK'))
    renderWithQuery(<UsersPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/^Couldn't load users: Request failed$/)
  })
})
