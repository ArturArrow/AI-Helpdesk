import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axios, { AxiosError } from 'axios'
import { MAX_RAG_DOCUMENT_BYTES } from 'core/constants/rag'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpError } from '@/test/http.ts'
import { renderWithQuery } from '@/test/render.tsx'
import UploadRagDocument from './UploadRagDocument.tsx'

const added = {
  id: '11111111-2222-4333-8444-555555555555',
  filename: 'manual.pdf',
  size: 4,
  chunkCount: 1,
  createdAt: '2026-11-10T08:00:00.000Z',
}

function pdf(name = 'manual.pdf') {
  return new File(['%PDF'], name, { type: 'application/pdf' })
}

// A file that reports `size` bytes without allocating them.
function fileOfSize(name: string, size: number) {
  const file = pdf(name)
  Object.defineProperty(file, 'size', { value: size })
  return file
}

function fileInput() {
  return screen.getByLabelText('Document to add')
}

// applyAccept: false lets a test choose any file, as a user can with the picker's "All files"
// option; the accept attribute is only a hint to the picker.
function renderUpload() {
  const user = userEvent.setup({ applyAccept: false })
  renderWithQuery(<UploadRagDocument />)
  return user
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('UploadRagDocument', () => {
  it('opens the file picker from the Add document button', async () => {
    const user = renderUpload()
    const pickerOpened = vi.fn()
    fileInput().addEventListener('click', pickerOpened)

    await user.click(screen.getByRole('button', { name: 'Add document' }))

    expect(pickerOpened).toHaveBeenCalledTimes(1)
  })

  it('only offers PDF and TXT files in the picker', () => {
    renderUpload()

    expect(fileInput()).toHaveAttribute('accept', '.pdf,.txt')
  })

  it('posts the chosen file under "file" to /api/rag/documents', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ status: 201, data: { document: added } })
    const user = renderUpload()
    const file = pdf()

    await user.upload(fileInput(), file)

    expect(post).toHaveBeenCalledExactlyOnceWith('/api/rag/documents', expect.any(FormData))
    const form = post.mock.calls[0]![1] as FormData
    expect(form.get('file')).toBe(file)
    expect(await screen.findByRole('button', { name: 'Add document' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('accepts an upper-case extension and a file of exactly the size limit', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ status: 201, data: { document: added } })
    const user = renderUpload()

    await user.upload(fileInput(), fileOfSize('MANUAL.PDF', MAX_RAG_DOCUMENT_BYTES))

    expect(post).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('rejects a file that is not PDF or TXT without sending it', async () => {
    const post = vi.spyOn(axios, 'post')
    const user = renderUpload()

    await user.upload(fileInput(), new File(['x'], 'notes.docx'))

    expect(screen.getByRole('alert')).toHaveTextContent(/^Only PDF and TXT files can be added\.$/)
    expect(post).not.toHaveBeenCalled()
  })

  it('rejects a file over the size limit without sending it', async () => {
    const post = vi.spyOn(axios, 'post')
    const user = renderUpload()

    await user.upload(fileInput(), fileOfSize('big.pdf', MAX_RAG_DOCUMENT_BYTES + 1))

    expect(screen.getByRole('alert')).toHaveTextContent(/^big\.pdf is over the 20\.0 MB limit\.$/)
    expect(post).not.toHaveBeenCalled()
  })

  it('shows "Indexing…" on a disabled button while the upload is pending', async () => {
    vi.spyOn(axios, 'post').mockReturnValue(new Promise(() => {}))
    const user = renderUpload()

    await user.upload(fileInput(), pdf())

    expect(await screen.findByRole('button', { name: 'Indexing…' })).toBeDisabled()
    expect(screen.getByText('A long PDF can take a minute.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add document' })).not.toBeInTheDocument()
  })

  it('shows the server message when the upload fails', async () => {
    vi.spyOn(axios, 'post').mockRejectedValue(httpError(409, { error: 'A document with this name already exists.' }))
    const user = renderUpload()

    await user.upload(fileInput(), pdf())

    expect(await screen.findByRole('alert')).toHaveTextContent(/^A document with this name already exists\.$/)
    expect(screen.getByRole('button', { name: 'Add document' })).toBeEnabled()
    expect(screen.queryByText('A long PDF can take a minute.')).not.toBeInTheDocument()
  })

  it.each([
    ['the response has no body', httpError(500)],
    ['there is no response', new AxiosError('Network Error', 'ERR_NETWORK')],
  ])('falls back to "Couldn\'t add the document." when %s', async (_, error) => {
    vi.spyOn(axios, 'post').mockRejectedValue(error)
    const user = renderUpload()

    await user.upload(fileInput(), pdf())

    expect(await screen.findByRole('alert')).toHaveTextContent(/^Couldn't add the document\.$/)
  })

  it('clears a rejected file\'s message when another file is chosen', async () => {
    vi.spyOn(axios, 'post').mockReturnValue(new Promise(() => {}))
    const user = renderUpload()
    await user.upload(fileInput(), new File(['x'], 'notes.docx'))
    expect(screen.getByRole('alert')).toBeInTheDocument()

    await user.upload(fileInput(), pdf())

    expect(await screen.findByRole('button', { name: 'Indexing…' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('clears a failed upload\'s message when another file is chosen', async () => {
    const post = vi
      .spyOn(axios, 'post')
      .mockRejectedValueOnce(httpError(409, { error: 'A document with this name already exists.' }))
      .mockReturnValueOnce(new Promise(() => {}))
    const user = renderUpload()
    await user.upload(fileInput(), pdf())
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    await user.upload(fileInput(), pdf('manual-v2.pdf'))

    expect(await screen.findByRole('button', { name: 'Indexing…' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(post).toHaveBeenCalledTimes(2)
  })
})
