import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { listedFiles, report, screenshot } from '@/test/attachments.ts'
import AttachmentList from './AttachmentList.tsx'

describe('AttachmentList', () => {
  it('links each file by name to its download URL under the given ticket', () => {
    render(<AttachmentList ticketId={42} attachments={[screenshot, report]} />)

    const list = screen.getByRole('list', { name: 'Attachments' })
    const links = within(list).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['shot.png', 'report.pdf'])
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/api/tickets/42/attachments/7',
      '/api/tickets/42/attachments/8',
    ])
  })

  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1 KB'],
    [1536, '2 KB'],
    [1024 * 1024 - 1024, '1023 KB'],
    [1024 * 1024, '1.0 MB'],
    [2.5 * 1024 * 1024, '2.5 MB'],
  ])('shows %i bytes as %s', (size, label) => {
    render(<AttachmentList ticketId={42} attachments={[{ ...report, size }]} />)

    expect(listedFiles()).toEqual([`report.pdf (${label})`])
  })

  it('shows a file that was too large as text, without a link', () => {
    const tooLarge = { ...report, filename: 'huge.zip', size: 30 * 1024 * 1024, tooLarge: true }
    render(<AttachmentList ticketId={42} attachments={[tooLarge, screenshot]} />)

    expect(listedFiles()).toEqual(['huge.zip (30.0 MB, too large, not stored)', 'shot.png (2 KB)'])
    expect(screen.queryByRole('link', { name: 'huge.zip' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'shot.png' })).toBeInTheDocument()
  })

  it('renders nothing when there are no attachments', () => {
    const { container } = render(<AttachmentList ticketId={42} attachments={[]} />)

    expect(container).toBeEmptyDOMElement()
  })
})
