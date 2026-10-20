import { getDefaultNormalizer, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axios, { AxiosError } from 'axios'
import { ReplySender } from 'core/constants/replySender'
import { categoryLabels, TicketCategory } from 'core/constants/ticketCategory'
import { TicketStatus } from 'core/constants/ticketStatus'
import { Route, Routes, useLocation, type InitialEntry } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpError } from '@/test/http.ts'
import { renderWithRouter } from '@/test/render.tsx'
import { choose } from '@/test/select.ts'
import TicketDetailPage from './TicketDetailPage.tsx'

const ticket = {
  id: 42,
  subject: 'Refund for order 1234',
  senderName: 'Rita Refund',
  senderEmail: 'rita@example.com',
  status: TicketStatus.open,
  category: TicketCategory.refund_request as TicketCategory | null,
  createdAt: '2026-04-04T09:30:00.000Z',
  updatedAt: '2026-04-05T14:15:00.000Z',
  body: 'Hello,\nplease refund my order.',
  assignedTo: { id: 'user-2', name: 'Alan Agent' } as { id: string; name: string } | null,
}

const agents = [
  { id: 'user-2', name: 'Alan Agent' },
  { id: 'user-3', name: 'Bea Agent' },
]

function mockGet() {
  return vi.spyOn(axios, 'get')
}

// Answers the three requests the page makes: the ticket, its replies, and the agents for the
// assignee select. Any other URL fails the request, so a stray GET can't pass unnoticed.
function mockTicketAndAgents(t: typeof ticket) {
  return mockGet().mockImplementation(async (url) => {
    if (url === '/api/tickets/assignees') return { data: { agents } }
    if (url === `/api/tickets/${t.id}/replies`) return { data: { replies: [] } }
    if (url === `/api/tickets/${t.id}`) return { data: { ticket: t } }
    throw new Error(`Unexpected GET ${url}`)
  })
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

function sidebar() {
  return screen.getByRole('complementary', { name: 'Ticket properties' })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TicketDetailPage', () => {
  it('requests the ticket and its replies for the id in the URL', async () => {
    const get = mockTicketAndAgents(ticket)
    renderAt('/tickets/42')

    await screen.findByText('No replies yet.')
    // The other request is the assignee select's agent list.
    expect(get.mock.calls.map(([url]) => url).filter((url) => url !== '/api/tickets/assignees')).toEqual([
      '/api/tickets/42',
      '/api/tickets/42/replies',
    ])
  })

  it('renders the subject, status, category, sender, assignee, dates and body', async () => {
    mockTicketAndAgents(ticket)
    renderAt('/tickets/42')

    expect(await screen.findByRole('heading', { name: 'Refund for order 1234', level: 1 })).toBeInTheDocument()
    expect(fields()).toEqual([
      ['From', 'Rita Refund <rita@example.com>'],
      ['Created', new Date(ticket.createdAt).toLocaleString()],
      ['Updated', new Date(ticket.updatedAt).toLocaleString()],
      // These values are selects; each trigger also holds an aria-hidden chevron.
      ['Assigned to', expect.stringContaining('Alan Agent')],
      ['Status', expect.stringContaining('Open')],
      ['Category', expect.stringContaining('Refund request')],
    ])
    expect(screen.getByRole('combobox', { name: 'Assigned to' })).toHaveTextContent('Alan Agent')
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent('Open')
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveTextContent('Refund request')
    expect(screen.getByText(/please refund my order/)).toBeInTheDocument()
    // Once the replies have loaded too, nothing on the page is busy.
    await screen.findByText('No replies yet.')
    expect(document.querySelector('[aria-busy="true"]')).not.toBeInTheDocument()
  })

  it('puts the editable fields in the Ticket properties sidebar and the rest outside it', async () => {
    mockTicketAndAgents(ticket)
    renderAt('/tickets/42')
    await screen.findByRole('heading', { name: ticket.subject, level: 1 })

    for (const name of ['Assigned to', 'Status', 'Category']) {
      expect(sidebar()).toContainElement(screen.getByRole('combobox', { name }))
    }
    for (const label of ['From', 'Created', 'Updated']) {
      expect(sidebar()).not.toContainElement(screen.getByText(label))
    }
  })

  it('shows Unclassified for a ticket without a category', async () => {
    mockTicketAndAgents({ ...ticket, status: TicketStatus.resolved, category: null })
    renderAt('/tickets/42')

    await screen.findByRole('heading', { name: ticket.subject, level: 1 })
    const category = screen.getByRole('combobox', { name: 'Category' })
    expect(category).toHaveTextContent('Unclassified')
    for (const label of Object.values(categoryLabels)) {
      expect(category).not.toHaveTextContent(label)
    }
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent('Resolved')
  })

  it('shows Unassigned for a ticket without an assignee', async () => {
    mockTicketAndAgents({ ...ticket, assignedTo: null })
    renderAt('/tickets/42')

    await screen.findByRole('heading', { name: ticket.subject, level: 1 })
    expect(fields()).toContainEqual(['Assigned to', expect.stringContaining('Unassigned')])
    const trigger = screen.getByRole('combobox', { name: 'Assigned to' })
    expect(trigger).toHaveTextContent('Unassigned')
    expect(trigger).not.toHaveTextContent('Alan Agent')
  })

  it('keeps the body as plain text with its line breaks and spacing', async () => {
    const body = 'Line one\n\n  indented <b>x</b>\nlast line  '
    mockTicketAndAgents({ ...ticket, body })
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
      mockTicketAndAgents(ticket)
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
      mockTicketAndAgents(ticket)
      renderAt('/tickets/42')
      await screen.findByRole('heading', { name: ticket.subject, level: 1 })

      const back = screen.getByRole('link', { name: 'Back to tickets' })
      expect(back).toHaveAttribute('href', '/tickets')
      await user.click(back)

      expect((await screen.findByRole('status', { name: 'List URL' })).textContent).toBe('/tickets')
    })
  })
  describe('assignee select', () => {
    const bea = { id: 'user-3', name: 'Bea Agent' }

    function assigneeSelect() {
      return screen.getByRole('combobox', { name: 'Assigned to' })
    }

    // Renders the ticket and waits until the agents have loaded and the select is usable.
    async function renderLoaded() {
      renderAt('/tickets/42')
      await waitFor(() => expect(assigneeSelect()).toBeEnabled())
    }

    it('lists Unassigned and then the agents when opened', async () => {
      const user = userEvent.setup()
      const get = mockTicketAndAgents(ticket)
      await renderLoaded()

      await user.click(assigneeSelect())

      const listbox = await screen.findByRole('listbox')
      expect(within(listbox).getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Unassigned',
        'Alan Agent',
        'Bea Agent',
      ])
      expect(get).toHaveBeenCalledWith('/api/tickets/assignees')
    })

    it('assigns the chosen agent and shows them in the trigger', async () => {
      const user = userEvent.setup()
      mockTicketAndAgents(ticket)
      const patch = vi.spyOn(axios, 'patch').mockResolvedValue({ data: { ticket: { ...ticket, assignedTo: bea } } })
      await renderLoaded()

      await choose(user, assigneeSelect(), 'Bea Agent')

      expect(patch).toHaveBeenCalledExactlyOnceWith('/api/tickets/42', { assignedToId: 'user-3' })
      await waitFor(() => expect(assigneeSelect()).toHaveTextContent('Bea Agent'))
      expect(assigneeSelect()).not.toHaveTextContent('Alan Agent')
      expect(assigneeSelect()).toBeEnabled()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('sends assignedToId: null for Unassigned', async () => {
      const user = userEvent.setup()
      mockTicketAndAgents(ticket)
      const patch = vi.spyOn(axios, 'patch').mockResolvedValue({ data: { ticket: { ...ticket, assignedTo: null } } })
      await renderLoaded()

      await choose(user, assigneeSelect(), 'Unassigned')

      expect(patch).toHaveBeenCalledExactlyOnceWith('/api/tickets/42', { assignedToId: null })
      await waitFor(() => expect(assigneeSelect()).toHaveTextContent('Unassigned'))
    })

    it('is disabled while the agents are loading', async () => {
      mockGet().mockImplementation((url) => {
        if (url === '/api/tickets/assignees') return new Promise(() => {})
        if (url === '/api/tickets/42/replies') return Promise.resolve({ data: { replies: [] } })
        return Promise.resolve({ data: { ticket } })
      })
      renderAt('/tickets/42')

      await screen.findByRole('heading', { name: ticket.subject, level: 1 })
      expect(assigneeSelect()).toBeDisabled()
      // The current assignee still shows while the list loads.
      expect(assigneeSelect()).toHaveTextContent('Alan Agent')
    })

    it('is disabled while the assignment is being saved', async () => {
      const user = userEvent.setup()
      mockTicketAndAgents(ticket)
      vi.spyOn(axios, 'patch').mockReturnValue(new Promise(() => {}))
      await renderLoaded()

      await choose(user, assigneeSelect(), 'Bea Agent')

      await waitFor(() => expect(assigneeSelect()).toBeDisabled())
    })

    it('shows an alert and keeps the previous assignee when the assignment fails', async () => {
      const user = userEvent.setup()
      mockTicketAndAgents(ticket)
      vi.spyOn(axios, 'patch').mockRejectedValue(httpError(400, { error: 'assignedToId must be an active agent' }))
      await renderLoaded()

      await choose(user, assigneeSelect(), 'Bea Agent')

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toBe("Couldn't update the ticket: Request failed (400)")
      expect(sidebar()).toContainElement(alert)
      expect(assigneeSelect()).toHaveTextContent('Alan Agent')
      expect(assigneeSelect()).not.toHaveTextContent('Bea Agent')
      expect(assigneeSelect()).toBeEnabled()
    })

    it('shows an alert when the agents fail to load', async () => {
      mockGet().mockImplementation(async (url) => {
        if (url === '/api/tickets/assignees') throw httpError(500)
        if (url === '/api/tickets/42/replies') return { data: { replies: [] } }
        return { data: { ticket } }
      })
      renderAt('/tickets/42')

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toBe("Couldn't load agents: Request failed (500)")
      // The ticket itself still renders.
      expect(screen.getByRole('heading', { name: ticket.subject, level: 1 })).toBeInTheDocument()
      expect(assigneeSelect()).toBeDisabled()
    })

    it('still shows a current assignee who is missing from the agents list by name', async () => {
      const user = userEvent.setup()
      // A soft-deleted agent: still on the ticket, no longer returned as an assignee.
      mockTicketAndAgents({ ...ticket, assignedTo: { id: 'user-9', name: 'Del Departed' } })
      await renderLoaded()

      expect(assigneeSelect()).toHaveTextContent('Del Departed')
      await user.click(assigneeSelect())
      const listbox = await screen.findByRole('listbox')
      expect(within(listbox).getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Unassigned',
        'Del Departed',
        'Alan Agent',
        'Bea Agent',
      ])
    })
  })

  describe('status and category selects', () => {
    function statusSelect() {
      return screen.getByRole('combobox', { name: 'Status' })
    }

    function categorySelect() {
      return screen.getByRole('combobox', { name: 'Category' })
    }

    // Waits for the agents too, so the assignee select's state is settled as well.
    async function renderLoaded(t = ticket) {
      mockTicketAndAgents(t)
      renderAt('/tickets/42')
      await waitFor(() => expect(screen.getByRole('combobox', { name: 'Assigned to' })).toBeEnabled())
    }

    it('lists the statuses, and Unclassified followed by the categories, when opened', async () => {
      const user = userEvent.setup()
      await renderLoaded()

      await user.click(statusSelect())
      const statuses = await screen.findByRole('listbox')
      expect(within(statuses).getAllByRole('option').map((o) => o.textContent)).toEqual(['Open', 'Resolved', 'Closed'])
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())

      await user.click(categorySelect())
      const categories = await screen.findByRole('listbox')
      expect(within(categories).getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Unclassified',
        'General question',
        'Technical question',
        'Refund request',
      ])
    })

    it('sends only the new status and shows it in the trigger', async () => {
      const user = userEvent.setup()
      const patch = vi
        .spyOn(axios, 'patch')
        .mockResolvedValue({ data: { ticket: { ...ticket, status: TicketStatus.resolved } } })
      await renderLoaded()

      await choose(user, statusSelect(), 'Resolved')

      expect(patch).toHaveBeenCalledExactlyOnceWith('/api/tickets/42', { status: TicketStatus.resolved })
      await waitFor(() => expect(statusSelect()).toHaveTextContent('Resolved'))
      expect(statusSelect()).not.toHaveTextContent('Open')
      expect(statusSelect()).toBeEnabled()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('sends only the new category and shows it in the trigger', async () => {
      const user = userEvent.setup()
      const patch = vi
        .spyOn(axios, 'patch')
        .mockResolvedValue({ data: { ticket: { ...ticket, category: TicketCategory.technical_question } } })
      await renderLoaded()

      await choose(user, categorySelect(), 'Technical question')

      expect(patch).toHaveBeenCalledExactlyOnceWith('/api/tickets/42', { category: TicketCategory.technical_question })
      await waitFor(() => expect(categorySelect()).toHaveTextContent('Technical question'))
      expect(categorySelect()).not.toHaveTextContent('Refund request')
    })

    it('sends category: null for Unclassified', async () => {
      const user = userEvent.setup()
      const patch = vi.spyOn(axios, 'patch').mockResolvedValue({ data: { ticket: { ...ticket, category: null } } })
      await renderLoaded()

      await choose(user, categorySelect(), 'Unclassified')

      expect(patch).toHaveBeenCalledExactlyOnceWith('/api/tickets/42', { category: null })
      await waitFor(() => expect(categorySelect()).toHaveTextContent('Unclassified'))
    })

    it('disables all three selects while an update is pending', async () => {
      const user = userEvent.setup()
      vi.spyOn(axios, 'patch').mockReturnValue(new Promise(() => {}))
      await renderLoaded()
      expect(statusSelect()).toBeEnabled()
      expect(categorySelect()).toBeEnabled()

      await choose(user, statusSelect(), 'Closed')

      await waitFor(() => expect(statusSelect()).toBeDisabled())
      expect(categorySelect()).toBeDisabled()
      expect(screen.getByRole('combobox', { name: 'Assigned to' })).toBeDisabled()
    })

    it('shows the shared alert and keeps the previous status when the update fails', async () => {
      const user = userEvent.setup()
      vi.spyOn(axios, 'patch').mockRejectedValue(httpError(500))
      await renderLoaded()

      await choose(user, statusSelect(), 'Closed')

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toBe("Couldn't update the ticket: Request failed (500)")
      expect(sidebar()).toContainElement(alert)
      expect(statusSelect()).toHaveTextContent('Open')
      expect(statusSelect()).not.toHaveTextContent('Closed')
      expect(statusSelect()).toBeEnabled()
    })

    it('shows the shared alert and keeps the previous category when the update fails', async () => {
      const user = userEvent.setup()
      vi.spyOn(axios, 'patch').mockRejectedValue(httpError(400, { error: 'Invalid category' }))
      await renderLoaded()

      await choose(user, categorySelect(), 'General question')

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toBe("Couldn't update the ticket: Request failed (400)")
      expect(sidebar()).toContainElement(alert)
      expect(categorySelect()).toHaveTextContent('Refund request')
      expect(categorySelect()).not.toHaveTextContent('General question')
      expect(categorySelect()).toBeEnabled()
    })
  })

  describe('replies', () => {
    it('shows a sent reply in the thread without fetching the replies again', async () => {
      const user = userEvent.setup()
      const get = mockTicketAndAgents(ticket)
      const reply = {
        id: 7,
        body: 'We have refunded your order.',
        sender: ReplySender.agent,
        createdAt: '2026-04-05T08:00:00.000Z',
        author: { id: 'user-2', name: 'Alan Agent' },
      }
      const post = vi.spyOn(axios, 'post').mockResolvedValue({ status: 201, data: { reply } })
      renderAt('/tickets/42')
      const thread = await screen.findByRole('region', { name: 'Replies' })
      await within(thread).findByText('No replies yet.')

      await user.type(screen.getByRole('textbox', { name: 'Reply' }), reply.body)
      await user.click(screen.getByRole('button', { name: 'Send reply' }))

      expect(post).toHaveBeenCalledExactlyOnceWith('/api/tickets/42/replies', { body: reply.body })
      const items = await within(thread).findAllByRole('listitem')
      expect(items).toHaveLength(1)
      expect(within(items[0]).getByText(reply.body)).toBeInTheDocument()
      expect(within(items[0]).getByText('Agent')).toBeInTheDocument()
      expect(within(thread).queryByText('No replies yet.')).not.toBeInTheDocument()
      expect(get.mock.calls.filter(([url]) => url === '/api/tickets/42/replies')).toHaveLength(1)
    })
  })
})
