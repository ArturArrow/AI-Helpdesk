import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import axios, { AxiosError } from 'axios'
import { TicketCategory } from 'core/constants/ticketCategory'
import { TicketStatus } from 'core/constants/ticketStatus'
import { useLocation, useNavigationType } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ticket } from '@/components/TicketsTable.tsx'
import { httpError } from '@/test/http.ts'
import { renderWithRouter } from '@/test/render.tsx'
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
    renderWithRouter(<TicketsPage />, '/tickets')

    expect(screen.getByRole('heading', { name: 'Tickets', level: 1 })).toBeInTheDocument()
    await screen.findByText('No tickets yet.')
  })

  it('shows skeleton rows while the request is pending', () => {
    mockGet().mockReturnValue(new Promise(() => {}))
    renderWithRouter(<TicketsPage />, '/tickets')

    const table = screen.getByRole('table')
    expect(table).toHaveAttribute('aria-busy', 'true')
    // Header row plus three placeholder rows, none of them holding text.
    const [, ...bodyRows] = within(table).getAllByRole('row')
    expect(bodyRows).toHaveLength(3)
    for (const row of bodyRows) expect(row.textContent).toBe('')
  })

  it('lists tickets from GET /api/tickets in the server order', async () => {
    const get = mockGet().mockResolvedValue({ data: { tickets } })
    renderWithRouter(<TicketsPage />, '/tickets')

    expect(await screen.findByRole('cell', { name: 'Refund for order 1234' })).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/api/tickets', { params: { sortBy: 'createdAt', sortOrder: 'desc' } })

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
    renderWithRouter(<TicketsPage />, '/tickets')
    await screen.findByRole('cell', { name: 'Something odd' })

    const [, , , , lastRow] = within(screen.getByRole('table')).getAllByRole('row')
    const fromCell = within(lastRow!).getAllByRole('cell')[1]!
    expect(within(fromCell).getByText('Una Unsorted')).toBeInTheDocument()
    expect(within(fromCell).getByText('una@example.com')).toBeInTheDocument()
  })

  it('shows an empty state instead of the table when there are no tickets', async () => {
    mockGet().mockResolvedValue({ data: { tickets: [] } })
    renderWithRouter(<TicketsPage />, '/tickets')

    expect(await screen.findByText('No tickets yet.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows the HTTP status when the request fails', async () => {
    mockGet().mockRejectedValue(httpError(500))
    renderWithRouter(<TicketsPage />, '/tickets')

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load tickets: Request failed (500)")
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows a generic message when the request fails without a response', async () => {
    mockGet().mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK'))
    renderWithRouter(<TicketsPage />, '/tickets')

    expect(await screen.findByRole('alert')).toHaveTextContent(/^Couldn't load tickets: Request failed$/)
  })

  describe('sorting', () => {
    function subjects() {
      const [, ...bodyRows] = within(screen.getByRole('table')).getAllByRole('row')
      return bodyRows.map((row) => within(row).getAllByRole('cell')[0]!.textContent)
    }

    function ariaSorts() {
      return screen.getAllByRole('columnheader').map((th) => th.getAttribute('aria-sort'))
    }

    it('requests newest first and marks Created as sorted descending', async () => {
      const get = mockGet().mockResolvedValue({ data: { tickets } })
      renderWithRouter(<TicketsPage />, '/tickets')
      await screen.findByRole('cell', { name: 'Refund for order 1234' })

      expect(get).toHaveBeenCalledTimes(1)
      expect(get).toHaveBeenCalledWith('/api/tickets', { params: { sortBy: 'createdAt', sortOrder: 'desc' } })
      expect(screen.getByRole('columnheader', { name: 'Created' })).toHaveAttribute('aria-sort', 'descending')
      expect(ariaSorts()).toEqual(['none', 'none', 'none', 'none', 'descending'])
    })

    it('sorts by Subject ascending on the first click and descending on the second', async () => {
      const user = userEvent.setup()
      const get = mockGet().mockResolvedValue({ data: { tickets } })
      renderWithRouter(<TicketsPage />, '/tickets')
      await screen.findByRole('cell', { name: 'Refund for order 1234' })

      await user.click(screen.getByRole('button', { name: 'Subject' }))
      await waitFor(() =>
        expect(get).toHaveBeenLastCalledWith('/api/tickets', { params: { sortBy: 'subject', sortOrder: 'asc' } }),
      )
      expect(ariaSorts()).toEqual(['ascending', 'none', 'none', 'none', 'none'])

      await user.click(screen.getByRole('button', { name: 'Subject' }))
      await waitFor(() =>
        expect(get).toHaveBeenLastCalledWith('/api/tickets', { params: { sortBy: 'subject', sortOrder: 'desc' } }),
      )
      expect(ariaSorts()).toEqual(['descending', 'none', 'none', 'none', 'none'])
    })

    it('sorts the From column by senderName', async () => {
      const user = userEvent.setup()
      const get = mockGet().mockResolvedValue({ data: { tickets } })
      renderWithRouter(<TicketsPage />, '/tickets')
      await screen.findByRole('cell', { name: 'Refund for order 1234' })

      await user.click(screen.getByRole('button', { name: 'From' }))

      await waitFor(() =>
        expect(get).toHaveBeenLastCalledWith('/api/tickets', { params: { sortBy: 'senderName', sortOrder: 'asc' } }),
      )
      expect(screen.getByRole('columnheader', { name: 'From' })).toHaveAttribute('aria-sort', 'ascending')
    })

    it('sorts Created newest first when switching to it from another column', async () => {
      const user = userEvent.setup()
      const get = mockGet().mockResolvedValue({ data: { tickets } })
      renderWithRouter(<TicketsPage />, '/tickets')
      await screen.findByRole('cell', { name: 'Refund for order 1234' })

      await user.click(screen.getByRole('button', { name: 'Status' }))
      await waitFor(() =>
        expect(get).toHaveBeenLastCalledWith('/api/tickets', { params: { sortBy: 'status', sortOrder: 'asc' } }),
      )

      await user.click(screen.getByRole('button', { name: 'Created' }))
      await waitFor(() =>
        expect(get).toHaveBeenLastCalledWith('/api/tickets', { params: { sortBy: 'createdAt', sortOrder: 'desc' } }),
      )
      expect(get).toHaveBeenCalledTimes(3)
      expect(ariaSorts()).toEqual(['none', 'none', 'none', 'none', 'descending'])
    })

    it('renders the rows in the order the server returns for the new sort', async () => {
      const user = userEvent.setup()
      const bySubject = [tickets[1]!, tickets[2]!, tickets[0]!, tickets[3]!]
      mockGet()
        .mockResolvedValueOnce({ data: { tickets } })
        .mockResolvedValueOnce({ data: { tickets: bySubject } })
      renderWithRouter(<TicketsPage />, '/tickets')
      await screen.findByRole('cell', { name: 'Refund for order 1234' })
      expect(subjects()).toEqual(['Refund for order 1234', 'App crashes on start', 'Opening hours?', 'Something odd'])

      await user.click(screen.getByRole('button', { name: 'Subject' }))

      await waitFor(() =>
        expect(subjects()).toEqual(['App crashes on start', 'Opening hours?', 'Refund for order 1234', 'Something odd']),
      )
      expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'false')
    })

    it('keeps the previous rows visible and marks the table busy while a re-sort loads', async () => {
      const user = userEvent.setup()
      const get = mockGet()
        .mockResolvedValueOnce({ data: { tickets } })
        .mockReturnValueOnce(new Promise(() => {}))
      renderWithRouter(<TicketsPage />, '/tickets')
      await screen.findByRole('cell', { name: 'Refund for order 1234' })
      expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'false')

      await user.click(screen.getByRole('button', { name: 'Subject' }))

      await waitFor(() => expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true'))
      expect(get).toHaveBeenLastCalledWith('/api/tickets', { params: { sortBy: 'subject', sortOrder: 'asc' } })
      expect(subjects()).toEqual(['Refund for order 1234', 'App crashes on start', 'Opening hours?', 'Something odd'])
      expect(screen.getByRole('columnheader', { name: 'Subject' })).toHaveAttribute('aria-sort', 'ascending')
    })
  })

  describe('filters', () => {
    const sortParams = { sortBy: 'createdAt', sortOrder: 'desc' }

    // Shows the router's current query string and how it got there (PUSH or REPLACE), so a test
    // can check what the page wrote to the URL.
    function LocationProbe() {
      return (
        <>
          <output aria-label="URL search">{useLocation().search}</output>
          <output aria-label="Navigation type">{useNavigationType()}</output>
        </>
      )
    }

    function urlSearch() {
      return screen.getByRole('status', { name: 'URL search' }).textContent
    }

    function navigationType() {
      return screen.getByRole('status', { name: 'Navigation type' }).textContent
    }

    function renderAt(route: string) {
      renderWithRouter(
        <>
          <TicketsPage />
          <LocationProbe />
        </>,
        route,
      )
    }

    function statusSelect() {
      return screen.getByRole('combobox', { name: 'Filter by status' })
    }

    function categorySelect() {
      return screen.getByRole('combobox', { name: 'Filter by category' })
    }

    async function choose(user: UserEvent, select: HTMLElement, option: string) {
      await user.click(select)
      await user.click(await screen.findByRole('option', { name: option }))
    }

    it('requests all tickets and shows no active filter without URL params', async () => {
      const get = mockGet().mockResolvedValue({ data: { tickets } })
      renderAt('/tickets')
      await screen.findByRole('cell', { name: 'Refund for order 1234' })

      expect(get).toHaveBeenCalledTimes(1)
      expect(get.mock.calls[0]![1]!.params).toStrictEqual(sortParams)
      expect(statusSelect()).toHaveTextContent('All statuses')
      expect(categorySelect()).toHaveTextContent('All categories')
      expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
    })

    it('applies the filters from the URL', async () => {
      const get = mockGet().mockResolvedValue({ data: { tickets: [tickets[0]!] } })
      renderAt('/tickets?status=resolved&category=refund_request')
      await screen.findByRole('cell', { name: 'Refund for order 1234' })

      expect(get).toHaveBeenCalledTimes(1)
      expect(get).toHaveBeenCalledWith('/api/tickets', {
        params: { ...sortParams, status: 'resolved', category: 'refund_request' },
      })
      expect(statusSelect()).toHaveTextContent('Resolved')
      expect(categorySelect()).toHaveTextContent('Refund request')
      expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
    })

    it('ignores the filters when a URL value is invalid', async () => {
      const get = mockGet().mockResolvedValue({ data: { tickets } })
      renderAt('/tickets?status=bogus&category=refund_request')
      await screen.findByRole('cell', { name: 'Refund for order 1234' })

      expect(get).toHaveBeenCalledTimes(1)
      expect(get.mock.calls[0]![1]!.params).toStrictEqual(sortParams)
      expect(statusSelect()).toHaveTextContent('All statuses')
      expect(categorySelect()).toHaveTextContent('All categories')
      expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
    })

    it('re-requests with the status chosen in the select and writes it to the URL', async () => {
      const user = userEvent.setup()
      const get = mockGet().mockResolvedValue({ data: { tickets } })
      renderAt('/tickets')
      await screen.findByRole('cell', { name: 'Refund for order 1234' })

      await choose(user, statusSelect(), 'Open')

      await waitFor(() =>
        expect(get).toHaveBeenLastCalledWith('/api/tickets', { params: { ...sortParams, status: 'open' } }),
      )
      expect(statusSelect()).toHaveTextContent('Open')
      expect(urlSearch()).toBe('?status=open')
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
    })

    it('re-requests with the category chosen in the select', async () => {
      const user = userEvent.setup()
      const get = mockGet().mockResolvedValue({ data: { tickets } })
      renderAt('/tickets')
      await screen.findByRole('cell', { name: 'Refund for order 1234' })

      await choose(user, categorySelect(), 'Technical question')

      await waitFor(() =>
        expect(get).toHaveBeenLastCalledWith('/api/tickets', {
          params: { ...sortParams, category: 'technical_question' },
        }),
      )
      expect(categorySelect()).toHaveTextContent('Technical question')
      expect(urlSearch()).toBe('?category=technical_question')
    })

    it('sends category=unclassified for the Unclassified option', async () => {
      const user = userEvent.setup()
      const get = mockGet().mockResolvedValue({ data: { tickets } })
      renderAt('/tickets')
      await screen.findByRole('cell', { name: 'Refund for order 1234' })

      await choose(user, categorySelect(), 'Unclassified')

      await waitFor(() =>
        expect(get).toHaveBeenLastCalledWith('/api/tickets', { params: { ...sortParams, category: 'unclassified' } }),
      )
      expect(urlSearch()).toBe('?category=unclassified')
    })

    it('drops the status param when All statuses is chosen, keeping the category', async () => {
      const user = userEvent.setup()
      const get = mockGet().mockResolvedValue({ data: { tickets } })
      renderAt('/tickets?status=open&category=general_question')
      await screen.findByRole('cell', { name: 'Refund for order 1234' })

      await choose(user, statusSelect(), 'All statuses')

      await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
      expect(get.mock.calls[1]![1]!.params).toStrictEqual({ ...sortParams, category: 'general_question' })
      expect(statusSelect()).toHaveTextContent('All statuses')
      expect(urlSearch()).toBe('?category=general_question')
    })

    it('keeps the sort when a filter changes', async () => {
      const user = userEvent.setup()
      const get = mockGet().mockResolvedValue({ data: { tickets } })
      renderAt('/tickets')
      await screen.findByRole('cell', { name: 'Refund for order 1234' })

      await user.click(screen.getByRole('button', { name: 'Subject' }))
      await waitFor(() =>
        expect(get).toHaveBeenLastCalledWith('/api/tickets', { params: { sortBy: 'subject', sortOrder: 'asc' } }),
      )

      await choose(user, statusSelect(), 'Closed')

      await waitFor(() =>
        expect(get).toHaveBeenLastCalledWith('/api/tickets', {
          params: { sortBy: 'subject', sortOrder: 'asc', status: 'closed' },
        }),
      )
      expect(screen.getByRole('columnheader', { name: 'Subject' })).toHaveAttribute('aria-sort', 'ascending')
    })

    it('keeps the filters when a column is re-sorted', async () => {
      const user = userEvent.setup()
      const get = mockGet().mockResolvedValue({ data: { tickets } })
      renderAt('/tickets?status=closed&category=unclassified')
      await screen.findByRole('cell', { name: 'Refund for order 1234' })

      await user.click(screen.getByRole('button', { name: 'Status' }))

      await waitFor(() =>
        expect(get).toHaveBeenLastCalledWith('/api/tickets', {
          params: { sortBy: 'status', sortOrder: 'asc', status: 'closed', category: 'unclassified' },
        }),
      )
      expect(statusSelect()).toHaveTextContent('Closed')
      expect(categorySelect()).toHaveTextContent('Unclassified')
      expect(urlSearch()).toBe('?status=closed&category=unclassified')
    })

    it('Clear filters resets both filters and re-requests without them', async () => {
      const user = userEvent.setup()
      const get = mockGet().mockResolvedValue({ data: { tickets } })
      renderAt('/tickets?status=resolved&category=refund_request')
      await screen.findByRole('cell', { name: 'Refund for order 1234' })

      await user.click(screen.getByRole('button', { name: 'Clear filters' }))

      await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
      expect(get.mock.calls[1]![1]!.params).toStrictEqual(sortParams)
      expect(statusSelect()).toHaveTextContent('All statuses')
      expect(categorySelect()).toHaveTextContent('All categories')
      expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
      expect(urlSearch()).toBe('')
    })

    it('shows a filter-specific empty state when filters match nothing', async () => {
      mockGet().mockResolvedValue({ data: { tickets: [] } })
      renderAt('/tickets?status=open')

      expect(await screen.findByText('No tickets match these filters.')).toBeInTheDocument()
      expect(screen.queryByText('No tickets yet.')).not.toBeInTheDocument()
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
    })

    it('shows "No tickets yet." once the filters are cleared from an empty result', async () => {
      const user = userEvent.setup()
      mockGet().mockResolvedValue({ data: { tickets: [] } })
      renderAt('/tickets?category=unclassified')
      await screen.findByText('No tickets match these filters.')

      await user.click(screen.getByRole('button', { name: 'Clear filters' }))

      expect(await screen.findByText('No tickets yet.')).toBeInTheDocument()
      expect(screen.queryByText('No tickets match these filters.')).not.toBeInTheDocument()
    })

    describe('search', () => {
      // The search box waits 300 ms after the last keystroke before it updates the filters.
      // Fake timers let a test step over that pause; shouldAdvanceTime keeps waitFor and
      // TanStack Query's own timers running.
      beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
      })

      afterEach(() => {
        vi.useRealTimers()
      })

      function searchBox() {
        return screen.getByRole('searchbox', { name: 'Search tickets' })
      }

      async function waitOutDebounce() {
        await act(() => vi.advanceTimersByTimeAsync(300))
      }

      it('sends one request with q once typing pauses, not one per keystroke', async () => {
        // 100 ms between keystrokes: shorter than the pause, so each one restarts it.
        const user = userEvent.setup({ delay: 100, advanceTimers: vi.advanceTimersByTime })
        const get = mockGet().mockResolvedValue({ data: { tickets } })
        renderAt('/tickets')
        await screen.findByRole('cell', { name: 'Refund for order 1234' })

        await user.type(searchBox(), 'refund')
        expect(searchBox()).toHaveValue('refund')
        // user-event also waits `delay` after the call returns, so 100 ms have passed since the
        // last keystroke; step to 250 ms, still short of the pause.
        await act(() => vi.advanceTimersByTimeAsync(150))
        expect(get).toHaveBeenCalledTimes(1)
        expect(urlSearch()).toBe('')

        await act(() => vi.advanceTimersByTimeAsync(50))
        await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
        expect(get).toHaveBeenLastCalledWith('/api/tickets', { params: { ...sortParams, q: 'refund' } })

        await waitOutDebounce()
        expect(get).toHaveBeenCalledTimes(2)
      })

      it('writes q to the URL and offers Clear filters', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        mockGet().mockResolvedValue({ data: { tickets } })
        renderAt('/tickets')
        await screen.findByRole('cell', { name: 'Refund for order 1234' })

        await user.type(searchBox(), 'refund')
        await waitOutDebounce()

        await waitFor(() => expect(urlSearch()).toBe('?q=refund'))
        expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
      })

      it('trims leading and trailing spaces from the request and the URL', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        const get = mockGet().mockResolvedValue({ data: { tickets } })
        renderAt('/tickets')
        await screen.findByRole('cell', { name: 'Refund for order 1234' })

        await user.type(searchBox(), '  refund  ')
        await waitOutDebounce()

        await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
        expect(get.mock.calls[1]![1]!.params).toStrictEqual({ ...sortParams, q: 'refund' })
        expect(urlSearch()).toBe('?q=refund')
        expect(searchBox()).toHaveValue('  refund  ')
      })

      it('drops q from the request and the URL when the box is cleared', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        const get = mockGet().mockResolvedValue({ data: { tickets } })
        renderAt('/tickets?q=refund')
        await screen.findByRole('cell', { name: 'Refund for order 1234' })

        await user.clear(searchBox())
        await waitOutDebounce()

        await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
        expect(get.mock.calls[1]![1]!.params).toStrictEqual(sortParams)
        expect(urlSearch()).toBe('')
        expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
      })

      it('drops q from the request and the URL when the box holds only spaces', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        const get = mockGet().mockResolvedValue({ data: { tickets } })
        renderAt('/tickets?q=refund')
        await screen.findByRole('cell', { name: 'Refund for order 1234' })

        await user.clear(searchBox())
        await user.type(searchBox(), '   ')
        await waitOutDebounce()

        await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
        expect(get.mock.calls[1]![1]!.params).toStrictEqual(sortParams)
        expect(urlSearch()).toBe('')
        expect(searchBox()).toHaveValue('   ')
      })

      it('keeps a trailing space typed mid-phrase after the search goes out', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        const get = mockGet().mockResolvedValue({ data: { tickets } })
        renderAt('/tickets')
        await screen.findByRole('cell', { name: 'Refund for order 1234' })

        await user.type(searchBox(), 'refund ')
        await waitOutDebounce()
        await waitFor(() => expect(urlSearch()).toBe('?q=refund'))
        expect(searchBox()).toHaveValue('refund ')

        await user.type(searchBox(), 'policy')
        await waitOutDebounce()

        expect(searchBox()).toHaveValue('refund policy')
        await waitFor(() =>
          expect(get).toHaveBeenLastCalledWith('/api/tickets', { params: { ...sortParams, q: 'refund policy' } }),
        )
        expect(urlSearch()).toBe('?q=refund+policy')
      })

      it('prefills the box from the URL and sends q with the first request', async () => {
        const get = mockGet().mockResolvedValue({ data: { tickets: [tickets[0]!] } })
        renderAt('/tickets?q=refund')
        await screen.findByRole('cell', { name: 'Refund for order 1234' })

        expect(searchBox()).toHaveValue('refund')
        expect(get.mock.calls[0]![1]!.params).toStrictEqual({ ...sortParams, q: 'refund' })
        expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()

        await waitOutDebounce()
        expect(get).toHaveBeenCalledTimes(1)
      })

      it('combines q with the status, the category and the sort', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        const get = mockGet().mockResolvedValue({ data: { tickets } })
        renderAt('/tickets?status=open&category=general_question')
        await screen.findByRole('cell', { name: 'Refund for order 1234' })

        await user.click(screen.getByRole('button', { name: 'Subject' }))
        await user.type(searchBox(), 'refund')
        await waitOutDebounce()
        const subjectAsc = { sortBy: 'subject', sortOrder: 'asc' }
        await waitFor(() =>
          expect(get).toHaveBeenLastCalledWith('/api/tickets', {
            params: { ...subjectAsc, status: 'open', category: 'general_question', q: 'refund' },
          }),
        )
        expect(urlSearch()).toBe('?status=open&category=general_question&q=refund')

        await choose(user, categorySelect(), 'Technical question')
        await waitFor(() =>
          expect(get).toHaveBeenLastCalledWith('/api/tickets', {
            params: { ...subjectAsc, status: 'open', category: 'technical_question', q: 'refund' },
          }),
        )
        expect(urlSearch()).toBe('?status=open&category=technical_question&q=refund')
        expect(searchBox()).toHaveValue('refund')

        await user.click(screen.getByRole('button', { name: 'Created' }))
        await waitFor(() =>
          expect(get).toHaveBeenLastCalledWith('/api/tickets', {
            params: { sortBy: 'createdAt', sortOrder: 'desc', status: 'open', category: 'technical_question', q: 'refund' },
          }),
        )
        expect(searchBox()).toHaveValue('refund')
      })

      it('Clear filters empties the box and removes q from the URL and the request', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        const get = mockGet().mockResolvedValue({ data: { tickets } })
        renderAt('/tickets?status=open&q=refund')
        await screen.findByRole('cell', { name: 'Refund for order 1234' })

        await user.click(screen.getByRole('button', { name: 'Clear filters' }))

        await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
        expect(get.mock.calls[1]![1]!.params).toStrictEqual(sortParams)
        expect(searchBox()).toHaveValue('')
        expect(urlSearch()).toBe('')

        await waitOutDebounce()
        expect(get).toHaveBeenCalledTimes(2)
        expect(urlSearch()).toBe('')
      })

      it('shows the filter-specific empty state when a search matches nothing', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        mockGet()
          .mockResolvedValueOnce({ data: { tickets } })
          .mockResolvedValue({ data: { tickets: [] } })
        renderAt('/tickets')
        await screen.findByRole('cell', { name: 'Refund for order 1234' })

        await user.type(searchBox(), 'nothing like this')
        await waitOutDebounce()

        expect(await screen.findByText('No tickets match these filters.')).toBeInTheDocument()
        expect(screen.queryByText('No tickets yet.')).not.toBeInTheDocument()
        expect(screen.queryByRole('table')).not.toBeInTheDocument()
      })

      it('replaces the history entry when searching but pushes one when a select changes', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        mockGet().mockResolvedValue({ data: { tickets } })
        renderAt('/tickets')
        await screen.findByRole('cell', { name: 'Refund for order 1234' })

        await choose(user, statusSelect(), 'Open')
        await waitFor(() => expect(urlSearch()).toBe('?status=open'))
        expect(navigationType()).toBe('PUSH')

        await user.type(searchBox(), 'refund')
        await waitOutDebounce()
        await waitFor(() => expect(urlSearch()).toBe('?status=open&q=refund'))
        expect(navigationType()).toBe('REPLACE')

        await choose(user, categorySelect(), 'Refund request')
        await waitFor(() => expect(urlSearch()).toBe('?status=open&q=refund&category=refund_request'))
        expect(navigationType()).toBe('PUSH')
      })
    })
  })
})
