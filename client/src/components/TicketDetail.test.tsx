import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import TicketDetail from './TicketDetail.tsx'

const ticket = {
  senderName: 'Grace Hopper',
  senderEmail: 'grace@example.com',
  createdAt: '2026-03-02T09:15:00.000Z',
  updatedAt: '2026-03-04T17:40:00.000Z',
  body: 'Hello,\n\nMy invoice is wrong.\n  Thanks',
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
})
