import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import TicketDetail from './TicketDetail.tsx'

const ticket = {
  senderName: 'Grace Hopper',
  senderEmail: 'grace@example.com',
  createdAt: '2026-03-02T09:15:00.000Z',
  updatedAt: '2026-03-04T17:40:00.000Z',
  body: 'Hello,\n\nMy invoice is wrong.\n  Thanks',
  bodyHTML: null as string | null,
}

describe('TicketDetail', () => {
  it('lists the sender and both timestamps', () => {
    render(<TicketDetail ticket={ticket} />)

    const terms = screen.getAllByRole('term').map((dt) => dt.textContent)
    const values = screen.getAllByRole('definition').map((dd) => dd.textContent)
    expect(terms).toEqual(['From', 'Created', 'Updated'])
    expect(values).toEqual([
      'Grace Hopper <grace@example.com>',
      new Date(ticket.createdAt).toLocaleString(),
      new Date(ticket.updatedAt).toLocaleString(),
    ])
  })

  it('shows the body as given, keeping its line breaks', () => {
    render(<TicketDetail ticket={ticket} />)

    const body = screen.getByText('My invoice is wrong.', { exact: false })
    expect(body.textContent).toBe(ticket.body)
  })

  it('renders the body as text, not HTML', () => {
    const { container } = render(<TicketDetail ticket={{ ...ticket, body: '<b>hi</b>' }} />)

    expect(screen.getByText('<b>hi</b>')).toBeInTheDocument()
    // Checking that no element was parsed out of the body needs a tag query.
    expect(container.querySelector('b')).toBeNull()
  })

  describe('HTML body', () => {
    it('renders the HTML body instead of the plain one when there is one', () => {
      render(<TicketDetail ticket={{ ...ticket, bodyHTML: '<p><strong>Bold</strong> text</p>' }} />)

      expect(screen.getByRole('strong')).toHaveTextContent(/^Bold$/)
      expect(screen.getByRole('paragraph').textContent).toBe('Bold text')
      expect(screen.queryByText('My invoice is wrong.', { exact: false })).not.toBeInTheDocument()
    })

    it('falls back to the plain body when the HTML body is an empty string', () => {
      render(<TicketDetail ticket={{ ...ticket, body: 'Plain <b>text</b>', bodyHTML: '' }} />)

      expect(screen.getByText('Plain <b>text</b>')).toBeInTheDocument()
    })

    it('strips scripts, event handlers and javascript: links but keeps the content around them', () => {
      const bodyHTML =
        '<p>Before</p>' +
        '<script>window.pwned = true</script>' +
        '<img src="x" alt="Logo" onerror="window.pwned = true">' +
        '<a href="javascript:window.pwned = true">Click me</a>' +
        '<p>After</p>'
      const { container } = render(<TicketDetail ticket={{ ...ticket, bodyHTML }} />)

      expect(screen.getByText('Before')).toBeInTheDocument()
      expect(screen.getByText('After')).toBeInTheDocument()
      // A script element has no role or text to find it by, so this needs a tag query.
      expect(container.querySelector('script')).toBeNull()
      expect(container.textContent).not.toContain('pwned')

      const img = screen.getByRole('img', { name: 'Logo' })
      expect(img).toHaveAttribute('src', 'x')
      expect(img).not.toHaveAttribute('onerror')

      const link = screen.getByText('Click me')
      expect(link).not.toHaveAttribute('href')
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    })
  })
})
