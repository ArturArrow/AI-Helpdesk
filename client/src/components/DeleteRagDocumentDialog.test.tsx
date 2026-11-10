import { screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import axios, { AxiosError } from 'axios'
import type { RagDocument } from 'core/constants/rag'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpError } from '@/test/http.ts'
import { renderWithQuery } from '@/test/render.tsx'
import DeleteRagDocumentDialog from './DeleteRagDocumentDialog.tsx'

const ragDocument: RagDocument = {
  id: '6f1c2a3e-1b2c-4d5e-8f90-123456789abc',
  filename: 'Refund policy.pdf',
  size: 2_621_440,
  chunkCount: 14,
  createdAt: '2026-10-02T12:00:00.000Z',
  hasFile: true,
}

// Confirming and the refetch that removes the row are covered with the table in RagPage.test.tsx.
function renderDialog() {
  const user = userEvent.setup()
  renderWithQuery(<DeleteRagDocumentDialog document={ragDocument} />)
  return user
}

async function openDialog(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: 'Delete Refund policy.pdf' }))
  return screen.getByRole('dialog', { name: 'Delete document' })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DeleteRagDocumentDialog', () => {
  it('opens a confirmation naming the document', async () => {
    const user = renderDialog()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const dialog = await openDialog(user)
    expect(dialog).toHaveAccessibleDescription(
      'Delete Refund policy.pdf? The AI will no longer answer tickets from it.',
    )
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeEnabled()
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('closes on Cancel without sending a DELETE', async () => {
    const del = vi.spyOn(axios, 'delete')
    const user = renderDialog()
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(del).not.toHaveBeenCalled()
  })

  it('disables the button and shows "Deleting…" while pending', async () => {
    const del = vi.spyOn(axios, 'delete').mockReturnValue(new Promise(() => {}))
    const user = renderDialog()
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(await within(dialog).findByRole('button', { name: 'Deleting…' })).toBeDisabled()
    expect(del).toHaveBeenCalledExactlyOnceWith(`/api/rag/documents/${ragDocument.id}`)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('DeleteRagDocumentDialog errors', () => {
  async function confirmWith(error: AxiosError) {
    vi.spyOn(axios, 'delete').mockRejectedValue(error)
    const user = renderDialog()
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    return { user, dialog }
  }

  it('shows the server message and stays open', async () => {
    const { dialog } = await confirmWith(httpError(502, { error: 'The document service is unavailable' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/^The document service is unavailable$/)
    expect(screen.getByRole('dialog', { name: 'Delete document' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeEnabled()
  })

  it.each([
    ['the response has no body', httpError(500)],
    ['there is no response', new AxiosError('Network Error', 'ERR_NETWORK')],
  ])('falls back to "Couldn\'t delete the document" when %s', async (_, error) => {
    const { dialog } = await confirmWith(error)

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/^Couldn't delete the document$/)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('shows no alert when reopened after a failed attempt is cancelled', async () => {
    const { user, dialog } = await confirmWith(httpError(404, { error: 'Document not found' }))
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const reopened = await openDialog(user)
    expect(within(reopened).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(reopened).getByRole('button', { name: 'Delete' })).toBeEnabled()
  })
})
