import { screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import axios, { AxiosError } from 'axios'
import { Role } from 'core/roles'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpError } from '@/test/http.ts'
import { renderWithQuery } from '@/test/render.tsx'
import { UsersQuery } from '@/test/UsersQuery.tsx'
import DeleteUserDialog from './DeleteUserDialog.tsx'
import type { User } from './UsersTable.tsx'

const agent: User = {
  id: '2',
  name: 'Alan Agent',
  email: 'agent@example.com',
  role: Role.agent,
  createdAt: '2026-03-02T12:00:00.000Z',
}

function renderDialog() {
  const user = userEvent.setup()
  renderWithQuery(<DeleteUserDialog user={agent} />)
  return user
}

async function openDialog(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: 'Delete Alan Agent' }))
  return screen.getByRole('dialog', { name: 'Delete user' })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DeleteUserDialog', () => {
  it('opens a confirmation naming the user and their email', async () => {
    const user = renderDialog()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const dialog = await openDialog(user)
    expect(dialog).toHaveAccessibleDescription(
      "Delete Alan Agent (agent@example.com)? They will be signed out and won't be able to sign in.",
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

  it('sends DELETE /api/users/:id, refetches the users list and closes', async () => {
    const get = vi.spyOn(axios, 'get').mockResolvedValue({ data: { users: [] } })
    // The server replies 204 No Content.
    const del = vi.spyOn(axios, 'delete').mockResolvedValue({ status: 204, data: '' })
    const user = userEvent.setup()
    renderWithQuery(
      <>
        <UsersQuery />
        <DeleteUserDialog user={agent} />
      </>,
    )
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))

    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(del).toHaveBeenCalledExactlyOnceWith('/api/users/2')
    expect(get).toHaveBeenCalledTimes(2)
    expect(get).toHaveBeenLastCalledWith('/api/users')
  })

  it('disables the button and shows "Deleting…" while pending', async () => {
    vi.spyOn(axios, 'delete').mockReturnValue(new Promise(() => {}))
    const user = renderDialog()
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(await within(dialog).findByRole('button', { name: 'Deleting…' })).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('DeleteUserDialog errors', () => {
  async function confirmWith(error: AxiosError) {
    vi.spyOn(axios, 'delete').mockRejectedValue(error)
    const user = renderDialog()
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    return { user, dialog }
  }

  it('shows the server message and stays open', async () => {
    const { dialog } = await confirmWith(httpError(403, { error: 'Admins cannot be deleted' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/^Admins cannot be deleted$/)
    expect(screen.getByRole('dialog', { name: 'Delete user' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeEnabled()
  })

  it('falls back to "Couldn\'t delete user" when the response has no body', async () => {
    const { dialog } = await confirmWith(httpError(500))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/^Couldn't delete user$/)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('falls back to "Couldn\'t delete user" when there is no response', async () => {
    const { dialog } = await confirmWith(new AxiosError('Network Error', 'ERR_NETWORK'))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/^Couldn't delete user$/)
  })

  it('shows no alert when reopened after a failed attempt is cancelled', async () => {
    const { user, dialog } = await confirmWith(httpError(404, { error: 'User not found' }))
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const reopened = await openDialog(user)
    expect(within(reopened).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(reopened).getByRole('button', { name: 'Delete' })).toBeEnabled()
  })
})
