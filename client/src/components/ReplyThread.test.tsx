import { act, screen, within } from '@testing-library/react'
import axios from 'axios'
import { EmailStatus } from 'core/constants/emailStatus'
import type { Attachment } from 'core/constants/attachment'
import { ReplySender } from 'core/constants/replySender'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listedFiles, report, screenshot } from '@/test/attachments.ts'
import { httpError } from '@/test/http.ts'
import { renderWithQuery } from '@/test/render.tsx'
import ReplyThread, { type Reply } from './ReplyThread.tsx'

const replies: Reply[] = [
  {
    id: 1,
    body: 'Hello, I was charged twice.',
    bodyHTML: null,
    sender: ReplySender.customer,
    emailStatus: null,
    createdAt: '2026-04-04T09:30:00.000Z',
    author: null,
    attachments: [],
  },
  {
    id: 2,
    body: 'Sorry about that, looking into it now.',
    bodyHTML: null,
    sender: ReplySender.agent,
    emailStatus: EmailStatus.sent,
    createdAt: '2026-04-04T10:05:00.000Z',
    author: { id: 'user-2', name: 'Alan Agent' },
    attachments: [],
  },
  {
    id: 3,
    body: 'Thanks!',
    bodyHTML: null,
    sender: ReplySender.customer,
    emailStatus: null,
    createdAt: '2026-04-04T11:45:00.000Z',
    author: null,
    attachments: [],
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
      emailStatus: EmailStatus.sent,
      createdAt: '2026-04-04T12:00:00.000Z',
      author: null,
      attachments: [],
    }
    mockGet().mockResolvedValue({ data: { replies: [aiReply] } })
    renderWithQuery(<ReplyThread ticket={{ id: 42 }} />)

    const item = within(await screen.findByRole('list')).getByRole('listitem')
    expect(within(item).getByText('AI')).toBeInTheDocument()
    expect(within(item).queryByText('Agent')).not.toBeInTheDocument()
    expect(within(item).queryByText('Customer')).not.toBeInTheDocument()
    expect(within(item).getByText(new Date(aiReply.createdAt).toLocaleString())).toBeInTheDocument()
    expect(within(item).getByText(aiReply.body)).toBeInTheDocument()
    // The label, date, email status and body, and nothing else: no author name.
    expect(item.textContent).toBe(`AI·${new Date(aiReply.createdAt).toLocaleString()}·Emailed${aiReply.body}`)
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
  describe('attachments', () => {
    const screenshotUrl = '/api/tickets/42/attachments/7'
    const inlineImage = '<p>See this</p><img src="cid:shot@x" alt="Screenshot">'

    // One customer reply as the only item in the thread. Its file list is a list too, so the reply
    // is awaited by its label rather than by role.
    async function renderReply(bodyHTML: string | null, attachments: Attachment[]) {
      mockGet().mockResolvedValue({ data: { replies: [{ ...replies[0], bodyHTML, attachments }] } })
      renderWithQuery(<ReplyThread ticket={{ id: 42 }} />)
      await within(thread()).findByText('Customer')
    }

    it("links a reply's files under the ticket's id, not the reply's", async () => {
      await renderReply(null, [report])

      expect(screen.getByRole('link', { name: 'report.pdf' })).toHaveAttribute(
        'href',
        '/api/tickets/42/attachments/8',
      )
    })

    it('shows no attachment list for a reply without files', async () => {
      await renderReply(inlineImage, [])

      expect(screen.queryByRole('list', { name: 'Attachments' })).not.toBeInTheDocument()
    })

    it('lists every file under a plain-text reply, inline images included', async () => {
      await renderReply(null, [screenshot, report])

      expect(screen.getByText(replies[0].body)).toBeInTheDocument()
      expect(listedFiles()).toEqual(['shot.png (2 KB)', 'report.pdf (512 B)'])
    })

    it("points a cid image at its URL under the ticket's id and leaves it out of the list", async () => {
      await renderReply(inlineImage, [screenshot, report])

      expect(screen.getByRole('img', { name: 'Screenshot' })).toHaveAttribute('src', screenshotUrl)
      expect(listedFiles()).toEqual(['report.pdf (512 B)'])
    })

    it('matches a URL-encoded cid', async () => {
      await renderReply('<img src="cid:shot%40x" alt="Screenshot">', [screenshot, report])

      expect(screen.getByRole('img', { name: 'Screenshot' })).toHaveAttribute('src', screenshotUrl)
      expect(listedFiles()).toEqual(['report.pdf (512 B)'])
    })

    it('leaves an unmatched cid as it is and keeps the file in the list', async () => {
      await renderReply('<img src="cid:other@x" alt="Screenshot">', [screenshot])

      expect(screen.getByRole('img', { name: 'Screenshot' })).toHaveAttribute('src', 'cid:other@x')
      expect(listedFiles()).toEqual(['shot.png (2 KB)'])
    })

    it('does not embed an SVG, and keeps it in the list as a download', async () => {
      await renderReply(inlineImage, [{ ...screenshot, filename: 'logo.svg', contentType: 'image/svg+xml' }])

      expect(screen.getByRole('img', { name: 'Screenshot' })).toHaveAttribute('src', 'cid:shot@x')
      expect(listedFiles()).toEqual(['logo.svg (2 KB)'])
      expect(screen.getByRole('link', { name: 'logo.svg' })).toHaveAttribute('href', screenshotUrl)
    })

    it('does not embed an image that was too large, and keeps it in the list', async () => {
      await renderReply(inlineImage, [{ ...screenshot, tooLarge: true }])

      expect(screen.getByRole('img', { name: 'Screenshot' })).toHaveAttribute('src', 'cid:shot@x')
      expect(listedFiles()).toEqual(['shot.png (2 KB, too large, not stored)'])
      expect(screen.queryByRole('link', { name: 'shot.png' })).not.toBeInTheDocument()
    })

    it('still strips scripts and event handlers from HTML with a cid image', async () => {
      await renderReply(
        '<p>Before</p>' +
          '<script>window.pwned = true</script>' +
          '<img src="cid:shot@x" alt="Screenshot" onerror="window.pwned = true">',
        [screenshot],
      )

      expect(within(thread()).getByText('Before')).toBeInTheDocument()
      // A script element has no role or text to find it by, so this needs a tag query.
      expect(thread().querySelector('script')).toBeNull()
      expect(thread().textContent).not.toContain('pwned')

      const img = screen.getByRole('img', { name: 'Screenshot' })
      expect(img).toHaveAttribute('src', screenshotUrl)
      expect(img).not.toHaveAttribute('onerror')
    })
  })

  describe('email status', () => {
    // One agent reply with the given email status, as the only item in the thread.
    async function renderReply(emailStatus: EmailStatus | null) {
      mockGet().mockResolvedValue({ data: { replies: [{ ...replies[1], emailStatus }] } })
      renderWithQuery(<ReplyThread ticket={{ id: 42 }} />)
      return within(await screen.findByRole('list')).getByRole('listitem')
    }

    it.each([
      [EmailStatus.pending, 'Sending…'],
      [EmailStatus.sent, 'Emailed'],
      [EmailStatus.failed, 'Not sent'],
    ])('shows %s as "%s" after the time', async (emailStatus, label) => {
      const item = await renderReply(emailStatus)

      const date = new Date(replies[1].createdAt).toLocaleString()
      expect(item.textContent).toBe(`Alan AgentAgent·${date}·${label}${replies[1].body}`)
    })

    it('styles a failed email as destructive', async () => {
      // The colour is the only cue besides the wording, so the class is what carries it.
      const item = await renderReply(EmailStatus.failed)
      expect(within(item).getByText('Not sent')).toHaveClass('text-destructive')
    })

    it('does not style a sent email as destructive', async () => {
      const item = await renderReply(EmailStatus.sent)
      expect(within(item).getByText('Emailed')).not.toHaveClass('text-destructive')
    })

    it('shows no status or extra separator for a customer reply', async () => {
      mockGet().mockResolvedValue({ data: { replies: [replies[0]] } })
      renderWithQuery(<ReplyThread ticket={{ id: 42 }} />)

      const item = within(await screen.findByRole('list')).getByRole('listitem')
      const date = new Date(replies[0].createdAt).toLocaleString()
      expect(item.textContent).toBe(`Customer·${date}${replies[0].body}`)
    })
  })

  describe('polling', () => {
    // shouldAdvanceTime keeps findBy* and TanStack Query's own timers running.
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    function repliesWith(emailStatus: EmailStatus) {
      return { data: { replies: [replies[0], { ...replies[1], emailStatus }] } }
    }

    it('refetches every 5 seconds while an email is pending, and stops once it is sent', async () => {
      const get = mockGet()
        .mockResolvedValueOnce(repliesWith(EmailStatus.pending))
        .mockResolvedValue(repliesWith(EmailStatus.sent))
      renderWithQuery(<ReplyThread ticket={{ id: 42 }} />)

      expect(await within(thread()).findByText('Sending…')).toBeInTheDocument()
      expect(get).toHaveBeenCalledTimes(1)

      await act(() => vi.advanceTimersByTimeAsync(5000))
      expect(await within(thread()).findByText('Emailed')).toBeInTheDocument()
      expect(within(thread()).queryByText('Sending…')).not.toBeInTheDocument()
      expect(get).toHaveBeenCalledTimes(2)
      expect(get).toHaveBeenLastCalledWith('/api/tickets/42/replies')

      await act(() => vi.advanceTimersByTimeAsync(15000))
      expect(get).toHaveBeenCalledTimes(2)
    })

    it('does not refetch when no email is pending', async () => {
      const get = mockGet().mockResolvedValue({
        data: { replies: [...replies, { ...replies[1], id: 4, emailStatus: EmailStatus.failed }] },
      })
      renderWithQuery(<ReplyThread ticket={{ id: 42 }} />)

      expect(await within(thread()).findByText('Not sent')).toBeInTheDocument()
      await act(() => vi.advanceTimersByTimeAsync(15000))
      expect(get).toHaveBeenCalledTimes(1)
    })
  })
})
