import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axios, { AxiosError } from 'axios'
import type { RagDocument } from 'core/constants/rag'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpError } from '@/test/http.ts'
import { renderWithQuery } from '@/test/render.tsx'
import RagPage from './RagPage.tsx'

const documents: RagDocument[] = [
  {
    id: '6f1c2a3e-1b2c-4d5e-8f90-123456789abc',
    filename: 'Refund policy.pdf',
    size: 2_621_440,
    chunkCount: 14,
    createdAt: '2026-10-02T12:00:00.000Z',
  },
  {
    id: '0a9b8c7d-6e5f-4a3b-9c2d-0123456789ab',
    filename: 'shipping.txt',
    size: 3_584,
    chunkCount: 2,
    createdAt: '2026-09-20T12:00:00.000Z',
  },
]

// The text of each body row's cells, in order.
function bodyRows() {
  const [, ...rows] = within(screen.getByRole('table')).getAllByRole('row')
  return rows.map((row) => within(row).getAllByRole('cell').map((td) => td.textContent))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RagPage', () => {
  it('shows the heading and the Add document button', () => {
    vi.spyOn(axios, 'get').mockResolvedValue({ data: { documents: [] } })
    renderWithQuery(<RagPage />)

    expect(screen.getByRole('heading', { name: 'Knowledge base', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add document' })).toBeEnabled()
  })

  it('shows skeleton rows while the request is pending', () => {
    vi.spyOn(axios, 'get').mockReturnValue(new Promise(() => {}))
    renderWithQuery(<RagPage />)

    const table = screen.getByRole('table')
    expect(table).toHaveAttribute('aria-busy', 'true')
    const [, ...rows] = within(table).getAllByRole('row')
    expect(rows).toHaveLength(3)
    for (const row of rows) expect(row.textContent).toBe('')
  })

  it('lists documents from GET /api/rag/documents with size, chunks and date', async () => {
    const get = vi.spyOn(axios, 'get').mockResolvedValue({ data: { documents } })
    renderWithQuery(<RagPage />)

    expect(await screen.findByRole('cell', { name: 'Refund policy.pdf' })).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/api/rag/documents')

    const table = screen.getByRole('table')
    expect(table).toHaveAttribute('aria-busy', 'false')
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Name',
      'Size',
      'Chunks',
      'Added',
      'Actions',
    ])
    // The actions cell holds only an icon button, so it has no text.
    expect(bodyRows()).toEqual([
      ['Refund policy.pdf', '2.5 MB', '14', new Date(documents[0]!.createdAt).toLocaleDateString(), ''],
      ['shipping.txt', '4 KB', '2', new Date(documents[1]!.createdAt).toLocaleDateString(), ''],
    ])
    expect(screen.getByRole('button', { name: 'Delete Refund policy.pdf' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete shipping.txt' })).toBeInTheDocument()
  })

  it('shows an empty state instead of the table when there are no documents', async () => {
    vi.spyOn(axios, 'get').mockResolvedValue({ data: { documents: [] } })
    renderWithQuery(<RagPage />)

    expect(await screen.findByText('No documents yet.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows the HTTP status when the request fails', async () => {
    vi.spyOn(axios, 'get').mockRejectedValue(httpError(503, { error: "The document service isn't configured" }))
    renderWithQuery(<RagPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/^Couldn't load documents: Request failed \(503\)$/)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows a generic message when the request fails without a response', async () => {
    vi.spyOn(axios, 'get').mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK'))
    renderWithQuery(<RagPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/^Couldn't load documents: Request failed$/)
  })

  it('puts an added document at the top of the list without refetching', async () => {
    const user = userEvent.setup()
    const get = vi.spyOn(axios, 'get').mockResolvedValue({ data: { documents } })
    const added: RagDocument = {
      id: '11111111-2222-4333-8444-555555555555',
      filename: 'FAQ.txt',
      size: 512,
      chunkCount: 1,
      createdAt: '2026-11-10T08:00:00.000Z',
    }
    vi.spyOn(axios, 'post').mockResolvedValue({ status: 201, data: { document: added } })
    renderWithQuery(<RagPage />)
    await screen.findByRole('cell', { name: 'Refund policy.pdf' })

    await user.upload(screen.getByLabelText('Document to add'), new File(['Q&A'], 'FAQ.txt', { type: 'text/plain' }))

    expect(await screen.findByRole('cell', { name: 'FAQ.txt' })).toBeInTheDocument()
    expect(bodyRows().map((cells) => cells[0])).toEqual(['FAQ.txt', 'Refund policy.pdf', 'shipping.txt'])
    expect(bodyRows()[0]).toEqual(['FAQ.txt', '512 B', '1', new Date(added.createdAt).toLocaleDateString(), ''])
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('removes a document from the list after it is deleted and the list is refetched', async () => {
    const user = userEvent.setup()
    const get = vi
      .spyOn(axios, 'get')
      .mockResolvedValueOnce({ data: { documents } })
      .mockResolvedValueOnce({ data: { documents: [documents[1]] } })
    // The server replies 204 No Content.
    const del = vi.spyOn(axios, 'delete').mockResolvedValue({ status: 204, data: '' })
    renderWithQuery(<RagPage />)

    await user.click(await screen.findByRole('button', { name: 'Delete Refund policy.pdf' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete document' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(del).toHaveBeenCalledExactlyOnceWith(`/api/rag/documents/${documents[0]!.id}`)
    expect(get).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('cell', { name: 'Refund policy.pdf' })).not.toBeInTheDocument()
    expect(bodyRows().map((cells) => cells[0])).toEqual(['shipping.txt'])
  })
})
