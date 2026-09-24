import { screen, within } from '@testing-library/react'
import axios, { AxiosError } from 'axios'
import { TicketCategory } from 'core/constants/ticketCategory'
import { TicketStatus } from 'core/constants/ticketStatus'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Ticket } from '@/components/TicketsTable.tsx'
import { httpError } from '@/test/http.ts'
import { renderWithQuery } from '@/test/render.tsx'
import TicketsPage from './TicketsPage.tsx'

// Newest first, as the server returns them.
const tickets: Ticket[] = [
  {
    id: 4,
    subject: 'Refund for order 1234',
    senderName: 'Rita Refund',
    senderEmail: 'rita@example.com',
    status: TicketStatus.open,
    category: TicketCategory.refund_request,
    createdAt: '2026-04-04T09:30:00.000Z',
  },
  {
    id: 3,
    subject: 'App crashes on start',
    senderName: 'Tom Tech',
    senderEmail: 'tom@example.com',
    status: TicketStatus.resolved,
    category: TicketCategory.technical_question,
    createdAt: '2026-03-03T08:00:00.000Z',
  },
  {
    id: 2,
    subject: 'Opening hours?',
    senderName: 'Gina General',
    senderEmail: 'gina@example.com',
    status: TicketStatus.closed,
    category: TicketCategory.general_question,
    createdAt: '2026-02-02T15:45:00.000Z',
  },
  {
    id: 1,
    subject: 'Something odd',
    senderName: 'Una Unsorted',
    senderEmail: 'una@example.com',
    status: TicketStatus.open,
    category: null,
    createdAt: '2026-01-01T10:00:00.000Z',
  },
]

function mockGet() {
  return vi.spyOn(axios, 'get')
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TicketsPage', () => {
  it('renders the Tickets heading', async () => {
    mockGet().mockResolvedValue({ data: { tickets: [] } })
    renderWithQuery(<TicketsPage />)

    expect(screen.getByRole('heading', { name: 'Tickets', level: 1 })).toBeInTheDocument()
    await screen.findByText('No tickets yet.')
  })

  it('shows skeleton rows while the request is pending', () => {
    mockGet().mockReturnValue(new Promise(() => {}))
    renderWithQuery(<TicketsPage />)

    const table = screen.getByRole('table')
    expect(table).toHaveAttribute('aria-busy', 'true')
    // Header row plus three placeholder rows, none of them holding text.
    const [, ...bodyRows] = within(table).getAllByRole('row')
    expect(bodyRows).toHaveLength(3)
    for (const row of bodyRows) expect(row.textContent).toBe('')
  })

  it('lists tickets from GET /api/tickets in the server order', async () => {
    const get = mockGet().mockResolvedValue({ data: { tickets } })
    renderWithQuery(<TicketsPage />)

    expect(await screen.findByRole('cell', { name: 'Refund for order 1234' })).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/api/tickets')

    const table = screen.getByRole('table')
    expect(table).toHaveAttribute('aria-busy', 'false')
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Subject',
      'From',
      'Status',
      'Category',
      'Created',
    ])

    const [, ...bodyRows] = within(table).getAllByRole('row')
    expect(bodyRows.map((row) => within(row).getAllByRole('cell').map((td) => td.textContent))).toEqual([
      [
        'Refund for order 1234',
        'Rita Refundrita@example.com',
        'open',
        'Refund request',
        new Date('2026-04-04T09:30:00.000Z').toLocaleString(),
      ],
      [
        'App crashes on start',
        'Tom Techtom@example.com',
        'resolved',
        'Technical question',
        new Date('2026-03-03T08:00:00.000Z').toLocaleString(),
      ],
      [
        'Opening hours?',
        'Gina Generalgina@example.com',
        'closed',
        'General question',
        new Date('2026-02-02T15:45:00.000Z').toLocaleString(),
      ],
      [
        'Something odd',
        'Una Unsorteduna@example.com',
        'open',
        'Unclassified',
        new Date('2026-01-01T10:00:00.000Z').toLocaleString(),
      ],
    ])
  })

  it('shows the sender name and email as separate lines in the From cell', async () => {
    mockGet().mockResolvedValue({ data: { tickets } })
    renderWithQuery(<TicketsPage />)
    await screen.findByRole('cell', { name: 'Something odd' })

    const [, , , , lastRow] = within(screen.getByRole('table')).getAllByRole('row')
    const fromCell = within(lastRow!).getAllByRole('cell')[1]!
    expect(within(fromCell).getByText('Una Unsorted')).toBeInTheDocument()
    expect(within(fromCell).getByText('una@example.com')).toBeInTheDocument()
  })

  it('shows an empty state instead of the table when there are no tickets', async () => {
    mockGet().mockResolvedValue({ data: { tickets: [] } })
    renderWithQuery(<TicketsPage />)

    expect(await screen.findByText('No tickets yet.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows the HTTP status when the request fails', async () => {
    mockGet().mockRejectedValue(httpError(500))
    renderWithQuery(<TicketsPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load tickets: Request failed (500)")
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows a generic message when the request fails without a response', async () => {
    mockGet().mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK'))
    renderWithQuery(<TicketsPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/^Couldn't load tickets: Request failed$/)
  })
})
