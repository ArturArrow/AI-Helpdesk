import { getDefaultNormalizer, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axios, { AxiosError } from 'axios'
import { TicketCategory } from 'core/constants/ticketCategory'
import { TicketStatus } from 'core/constants/ticketStatus'
import { Route, Routes, useLocation, type InitialEntry } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { categoryLabels } from '@/lib/ticketLabels.ts'
import { httpError } from '@/test/http.ts'
import { renderWithRouter } from '@/test/render.tsx'
import TicketDetailPage from './TicketDetailPage.tsx'

const ticket = {
  id: 42,
  subject: 'Refund for order 1234',
  senderName: 'Rita Refund',
  senderEmail: 'rita@example.com',
  status: TicketStatus.open,
  category: TicketCategory.refund_request,
  createdAt: '2026-04-04T09:30:00.000Z',
  updatedAt: '2026-04-05T14:15:00.000Z',
  body: 'Hello,\nplease refund my order.',
  assignedTo: { id: 'user-2', name: 'Alan Agent' },
}

function mockGet() {
  return vi.spyOn(axios, 'get')
}

// Stands in for the list page, showing where the back link led.
function ListProbe() {
  const location = useLocation()
  return <output aria-label="List URL">{location.pathname + location.search}</output>
}

function renderAt(route: InitialEntry) {
  renderWithRouter(
    <Routes>
      <Route path="/tickets/:id" element={<TicketDetailPage />} />
      <Route path="/tickets" element={<ListProbe />} />
    </Routes>,
    route,
  )
}

// The field labels (dt) and values (dd), paired in the order they're shown.
function fields() {
  const terms = screen.getAllByRole('term').map((dt) => dt.textContent)
  const values = screen.getAllByRole('definition').map((dd) => dd.textContent)
  return terms.map((term, i) => [term, values[i]])
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TicketDetailPage', () => {
  it('requests the ticket for the id in the URL', async () => {
    const get = mockGet().mockResolvedValue({ data: { ticket } })
    renderAt('/tickets/42')

    await screen.findByRole('heading', { name: ticket.subject, level: 1 })
    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith('/api/tickets/42')
  })

  it('renders the subject, status, category, sender, assignee, dates and body', async () => {
    mockGet().mockResolvedValue({ data: { ticket } })
    renderAt('/tickets/42')

    expect(await screen.findByRole('heading', { name: 'Refund for order 1234', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Open · Refund request')).toBeInTheDocument()
    expect(fields()).toEqual([
      ['From', 'Rita Refund <rita@example.com>'],
      ['Assigned to', 'Alan Agent'],
      ['Created', new Date(ticket.createdAt).toLocaleString()],
      ['Updated', new Date(ticket.updatedAt).toLocaleString()],
    ])
    expect(screen.getByText(/please refund my order/)).toBeInTheDocument()
    expect(document.querySelector('[aria-busy="true"]')).not.toBeInTheDocument()
  })

  it('shows Unclassified for a ticket without a category', async () => {
    mockGet().mockResolvedValue({
      data: { ticket: { ...ticket, status: TicketStatus.resolved, category: null } },
    })
    renderAt('/tickets/42')

    await screen.findByRole('heading', { name: ticket.subject, level: 1 })
    expect(screen.getByText('Unclassified')).toBeInTheDocument()
    expect(screen.getByText(/^Resolved ·/)).toBeInTheDocument()
    for (const label of Object.values(categoryLabels)) {
      expect(screen.queryByText(label, { exact: false })).not.toBeInTheDocument()
    }
  })

  it('shows Unassigned for a ticket without an assignee', async () => {
    mockGet().mockResolvedValue({ data: { ticket: { ...ticket, assignedTo: null } } })
    renderAt('/tickets/42')

    await screen.findByRole('heading', { name: ticket.subject, level: 1 })
    expect(fields()).toContainEqual(['Assigned to', 'Unassigned'])
  })

  it('keeps the body as plain text with its line breaks and spacing', async () => {
    const body = 'Line one\n\n  indented <b>x</b>\nlast line  '
    mockGet().mockResolvedValue({ data: { ticket: { ...ticket, body } } })
    renderAt('/tickets/42')
    await screen.findByRole('heading', { name: ticket.subject, level: 1 })

    const bodyEl = screen.getByText(body, {
      normalizer: getDefaultNormalizer({ trim: false, collapseWhitespace: false }),
    })
    expect(bodyEl.textContent).toBe(body)
    // Rendered as HTML, the tag would become a <b> element holding just "x".
    expect(screen.queryByText('x')).not.toBeInTheDocument()
  })

  it('shows a busy skeleton while the request is pending', () => {
    mockGet().mockReturnValue(new Promise(() => {}))
    renderAt('/tickets/42')

    // The skeleton wrapper has no role or name; aria-busy is what marks it for assistive tech.
    const skeleton = document.querySelector('[aria-busy="true"]')
    expect(skeleton).toBeInTheDocument()
    expect(skeleton!.textContent).toBe('')
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to tickets' })).toBeInTheDocument()
  })

  it('says the ticket was not found on a 404', async () => {
    mockGet().mockRejectedValue(httpError(404, { error: 'Ticket not found' }))
    renderAt('/tickets/999')

    expect(await screen.findByText('Ticket not found.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(document.querySelector('[aria-busy="true"]')).not.toBeInTheDocument()
  })

  it('shows an alert with the HTTP status when the request fails otherwise', async () => {
    mockGet().mockRejectedValue(httpError(500))
    renderAt('/tickets/42')

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the ticket: Request failed (500)")
    expect(screen.queryByText('Ticket not found.')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('shows a generic alert when the request fails without a response', async () => {
    mockGet().mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK'))
    renderAt('/tickets/42')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe("Couldn't load the ticket: Request failed")
  })

  describe('back link', () => {
    it('returns to the list URL passed in state.from, keeping its filters, sort and page', async () => {
      const user = userEvent.setup()
      mockGet().mockResolvedValue({ data: { ticket } })
      const from = '/tickets?status=open&sortBy=subject&sortOrder=asc&page=2'
      renderAt({ pathname: '/tickets/42', state: { from } })
      await screen.findByRole('heading', { name: ticket.subject, level: 1 })

      const back = screen.getByRole('link', { name: 'Back to tickets' })
      expect(back).toHaveAttribute('href', from)
      await user.click(back)

      expect((await screen.findByRole('status', { name: 'List URL' })).textContent).toBe(from)
    })

    it('goes to /tickets when opened without state (e.g. a direct link)', async () => {
      const user = userEvent.setup()
      mockGet().mockResolvedValue({ data: { ticket } })
      renderAt('/tickets/42')
      await screen.findByRole('heading', { name: ticket.subject, level: 1 })

      const back = screen.getByRole('link', { name: 'Back to tickets' })
      expect(back).toHaveAttribute('href', '/tickets')
      await user.click(back)

      expect((await screen.findByRole('status', { name: 'List URL' })).textContent).toBe('/tickets')
    })
  })
})
