import { screen, within } from '@testing-library/react'
import axios from 'axios'
import { ReplySender } from 'core/constants/replySender'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpError } from '@/test/http.ts'
import { renderWithQuery } from '@/test/render.tsx'
import ReplyThread, { type Reply } from './ReplyThread.tsx'

const replies: Reply[] = [
  {
    id: 1,
    body: 'Hello, I was charged twice.',
    bodyHTML: null,
    sender: ReplySender.customer,
    createdAt: '2026-04-04T09:30:00.000Z',
    author: null,
  },
  {
    id: 2,
    body: 'Sorry about that, looking into it now.',
    bodyHTML: null,
    sender: ReplySender.agent,
    createdAt: '2026-04-04T10:05:00.000Z',
    author: { id: 'user-2', name: 'Alan Agent' },
  },
  {
    id: 3,
    body: 'Thanks!',
    bodyHTML: null,
    sender: ReplySender.customer,
    createdAt: '2026-04-04T11:45:00.000Z',
    author: null,
  },
]

function mockGet() {
  return vi.spyOn(axios, 'get')
}

function thread() {
  return screen.getByRole('region', { name: 'Replies' })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ReplyThread', () => {
  it('requests the replies of the given ticket', async () => {
    const get = mockGet().mockResolvedValue({ data: { replies } })
    renderWithQuery(<ReplyThread ticket={{ id: 42 }} />)

    await screen.findByRole('list')
    expect(get).toHaveBeenCalledExactlyOnceWith('/api/tickets/42/replies')
  })

  it('lists the replies in the order the API returns them', async () => {
    mockGet().mockResolvedValue({ data: { replies } })
    renderWithQuery(<ReplyThread ticket={{ id: 42 }} />)

    const items = within(await screen.findByRole('list')).getAllByRole('listitem')
    expect(items).toHaveLength(replies.length)
    items.forEach((item, i) => expect(item).toHaveTextContent(replies[i].body))
    expect(document.querySelector('[aria-busy="true"]')).not.toBeInTheDocument()
  })

  it("shows an agent reply's author, the Agent label, the date and the body", async () => {
    mockGet().mockResolvedValue({ data: { replies } })
    renderWithQuery(<ReplyThread ticket={{ id: 42 }} />)

    const item = within(await screen.findByRole('list')).getAllByRole('listitem')[1]
    expect(within(item).getByText('Alan Agent')).toBeInTheDocument()
    expect(within(item).getByText('Agent')).toBeInTheDocument()
    expect(within(item).queryByText('Customer')).not.toBeInTheDocument()
    expect(within(item).getByText(new Date(replies[1].createdAt).toLocaleString())).toBeInTheDocument()
    expect(within(item).getByText(replies[1].body)).toBeInTheDocument()
  })

  it('shows a customer reply with the Customer label and no author', async () => {
    mockGet().mockResolvedValue({ data: { replies } })
    renderWithQuery(<ReplyThread ticket={{ id: 42 }} />)

    const item = within(await screen.findByRole('list')).getAllByRole('listitem')[0]
    expect(within(item).getByText('Customer')).toBeInTheDocument()
    expect(within(item).queryByText('Agent')).not.toBeInTheDocument()
    expect(within(item).queryByText('Alan Agent')).not.toBeInTheDocument()
    expect(within(item).getByText(new Date(replies[0].createdAt).toLocaleString())).toBeInTheDocument()
    expect(within(item).getByText(replies[0].body)).toBeInTheDocument()
  })

  it('shows an AI reply with the AI label and no author', async () => {
    const aiReply: Reply = {
      id: 4,
      body: 'You can request a refund from the Orders page.',
      bodyHTML: null,
      sender: ReplySender.ai,
      createdAt: '2026-04-04T12:00:00.000Z',
      author: null,
    }
    mockGet().mockResolvedValue({ data: { replies: [aiReply] } })
    renderWithQuery(<ReplyThread ticket={{ id: 42 }} />)

    const item = within(await screen.findByRole('list')).getByRole('listitem')
    expect(within(item).getByText('AI')).toBeInTheDocument()
    expect(within(item).queryByText('Agent')).not.toBeInTheDocument()
    expect(within(item).queryByText('Customer')).not.toBeInTheDocument()
    expect(within(item).getByText(new Date(aiReply.createdAt).toLocaleString())).toBeInTheDocument()
    expect(within(item).getByText(aiReply.body)).toBeInTheDocument()
    // The label, separator, date and body, and nothing else: no author name.
    expect(item.textContent).toBe(`AI·${new Date(aiReply.createdAt).toLocaleString()}${aiReply.body}`)
  })

  it('says there are no replies when the list is empty', async () => {
    mockGet().mockResolvedValue({ data: { replies: [] } })
    renderWithQuery(<ReplyThread ticket={{ id: 42 }} />)

    expect(await within(thread()).findByText('No replies yet.')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a busy skeleton under the heading while the replies load', () => {
    mockGet().mockReturnValue(new Promise(() => {}))
    renderWithQuery(<ReplyThread ticket={{ id: 42 }} />)

    expect(within(thread()).getByRole('heading', { name: 'Replies' })).toBeInTheDocument()
    // The skeleton wrapper has no role or name; aria-busy is what marks it for assistive tech.
    const skeleton = document.querySelector('[aria-busy="true"]')
    expect(thread()).toContainElement(skeleton as HTMLElement | null)
    expect(skeleton!.textContent).toBe('')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.queryByText('No replies yet.')).not.toBeInTheDocument()
  })

  it('shows an alert with the HTTP status when the replies fail to load', async () => {
    mockGet().mockRejectedValue(httpError(500))
    renderWithQuery(<ReplyThread ticket={{ id: 42 }} />)

    const alert = await within(thread()).findByRole('alert')
    expect(alert.textContent).toBe("Couldn't load the replies: Request failed (500)")
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(document.querySelector('[aria-busy="true"]')).not.toBeInTheDocument()
  })

  describe('HTML body', () => {
    // One customer reply, with the given bodies, as the only item in the thread.
    async function renderReply(body: string, bodyHTML: string | null) {
      mockGet().mockResolvedValue({ data: { replies: [{ ...replies[0], body, bodyHTML }] } })
      renderWithQuery(<ReplyThread ticket={{ id: 42 }} />)
      return within(await screen.findByRole('list')).getByRole('listitem')
    }

    it('renders the HTML body instead of the plain one when there is one', async () => {
      const item = await renderReply('Plain fallback', '<p><strong>Bold</strong> text</p>')

      expect(within(item).getByRole('strong')).toHaveTextContent(/^Bold$/)
      expect(within(item).getByRole('paragraph').textContent).toBe('Bold text')
      expect(within(item).queryByText('Plain fallback')).not.toBeInTheDocument()
    })

    it('strips scripts, event handlers and javascript: links but keeps the content around them', async () => {
      const item = await renderReply(
        'Plain fallback',
        '<p>Before</p>' +
          '<script>window.pwned = true</script>' +
          '<img src="x" alt="Logo" onerror="window.pwned = true">' +
          '<a href="javascript:window.pwned = true">Click me</a>' +
          '<p>After</p>',
      )

      expect(within(item).getByText('Before')).toBeInTheDocument()
      expect(within(item).getByText('After')).toBeInTheDocument()
      // A script element has no role or text to find it by, so this needs a tag query.
      expect(item.querySelector('script')).toBeNull()
      expect(item.textContent).not.toContain('pwned')

      const img = within(item).getByRole('img', { name: 'Logo' })
      expect(img).toHaveAttribute('src', 'x')
      expect(img).not.toHaveAttribute('onerror')

      expect(within(item).getByText('Click me')).not.toHaveAttribute('href')
      expect(within(item).queryByRole('link')).not.toBeInTheDocument()
    })

    it('shows the plain body as text, not HTML, when the HTML body is null', async () => {
      const item = await renderReply('Plain <b>text</b>', null)

      expect(within(item).getByText('Plain <b>text</b>')).toBeInTheDocument()
      // Checking that no element was parsed out of the body needs a tag query.
      expect(item.querySelector('b')).toBeNull()
    })

    it('falls back to the plain body when the HTML body is an empty string', async () => {
      const item = await renderReply('Plain fallback', '')

      expect(within(item).getByText('Plain fallback')).toBeInTheDocument()
    })
  })
})
