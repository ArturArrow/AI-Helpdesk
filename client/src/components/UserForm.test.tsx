import { screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import axios, { AxiosError } from 'axios'
import { Role } from 'core/constants/role'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpError } from '@/test/http.ts'
import { renderWithQuery } from '@/test/render.tsx'
import { UsersQuery } from '@/test/UsersQuery.tsx'
import UserForm from './UserForm.tsx'
import type { User } from './UsersTable.tsx'

const created = {
  user: {
    id: '3',
    name: 'Grace Hopper',
    email: 'grace@example.com',
    role: Role.agent,
    createdAt: '2026-09-01T12:00:00.000Z',
  },
}

function renderForm() {
  const user = userEvent.setup()
  renderWithQuery(<UserForm />)
  return user
}

async function openDialog(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: 'New user' }))
  return screen.getByRole('dialog', { name: 'New user' })
}

async function fillForm(user: UserEvent, values: { name: string; email: string; password: string }) {
  if (values.name) await user.type(screen.getByLabelText('Name'), values.name)
  if (values.email) await user.type(screen.getByLabelText('Email'), values.email)
  if (values.password) await user.type(screen.getByLabelText('Password'), values.password)
}

const valid = { name: 'Grace Hopper', email: 'grace@example.com', password: 'correct-horse' }

afterEach(() => {
  vi.restoreAllMocks()
})

describe('UserForm create validation', () => {
  it('shows an error on every field when submitted empty, without posting', async () => {
    const post = vi.spyOn(axios, 'post')
    const user = renderForm()
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }))

    expect(within(dialog).getAllByRole('alert').map((el) => el.textContent)).toEqual([
      'Name must be at least 3 characters',
      'Enter a valid email address',
      'Password must be at least 8 characters',
    ])
    for (const label of ['Name', 'Email', 'Password']) {
      expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'true')
    }
    expect(post).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('rejects a short name, an invalid email and a short password', async () => {
    const post = vi.spyOn(axios, 'post')
    const user = renderForm()
    const dialog = await openDialog(user)
    await fillForm(user, { name: 'Al', email: 'not-an-email', password: 'short' })
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }))

    expect(within(dialog).getAllByRole('alert').map((el) => el.textContent)).toEqual([
      'Name must be at least 3 characters',
      'Enter a valid email address',
      'Password must be at least 8 characters',
    ])
    expect(post).not.toHaveBeenCalled()
  })

  it('marks only the invalid field', async () => {
    vi.spyOn(axios, 'post')
    const user = renderForm()
    const dialog = await openDialog(user)
    await fillForm(user, { ...valid, password: 'short' })
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }))

    expect(within(dialog).getByRole('alert')).toHaveTextContent('Password must be at least 8 characters')
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'false')
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'false')
  })
})

describe('UserForm create submit', () => {
  it('posts the parsed values, refetches the users list and closes', async () => {
    const get = vi.spyOn(axios, 'get').mockResolvedValue({ data: { users: [] } })
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: created })
    const user = userEvent.setup()
    renderWithQuery(
      <>
        <UsersQuery />
        <UserForm />
      </>,
    )
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))

    const dialog = await openDialog(user)
    await fillForm(user, { name: '  Grace Hopper  ', email: '  Grace@Example.COM ', password: 'correct-horse' })
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(post).toHaveBeenCalledWith('/api/users', {
      name: 'Grace Hopper',
      email: 'grace@example.com',
      password: 'correct-horse',
    })
    expect(get).toHaveBeenCalledTimes(2)
    expect(get).toHaveBeenLastCalledWith('/api/users')
  })

  it('disables the submit button and shows "Creating…" while pending', async () => {
    vi.spyOn(axios, 'post').mockReturnValue(new Promise(() => {}))
    const user = renderForm()
    const dialog = await openDialog(user)
    await fillForm(user, valid)
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }))

    const button = await within(dialog).findByRole('button', { name: 'Creating…' })
    expect(button).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: 'Create user' })).not.toBeInTheDocument()
  })
})

describe('UserForm create server errors', () => {
  async function submitWith(error: AxiosError) {
    vi.spyOn(axios, 'post').mockRejectedValue(error)
    const user = renderForm()
    const dialog = await openDialog(user)
    await fillForm(user, valid)
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }))
    return { user, dialog }
  }

  it('shows the server message under the email field on 409', async () => {
    const { dialog } = await submitWith(httpError(409, { error: 'That email is taken' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/^That email is taken$/)
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'false')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('falls back to a default email message on 409 without a body', async () => {
    const { dialog } = await submitWith(httpError(409))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /^A user with this email already exists$/,
    )
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
  })

  it('shows the server message in a form-level alert on other errors', async () => {
    const { dialog } = await submitWith(httpError(500, { error: 'Database unavailable' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/^Database unavailable$/)
    for (const label of ['Name', 'Email', 'Password']) {
      expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'false')
    }
  })

  it('falls back to a generic form-level message when there is no server message', async () => {
    const { dialog } = await submitWith(new AxiosError('Network Error', 'ERR_NETWORK'))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/^Couldn't create user$/)
  })
})

describe('UserForm create reopening', () => {
  function expectEmptyForm(dialog: HTMLElement) {
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    for (const label of ['Name', 'Email', 'Password']) {
      const input = screen.getByLabelText(label)
      expect(input).toHaveValue('')
      expect(input).toHaveAttribute('aria-invalid', 'false')
    }
  }

  it('starts empty after a failed attempt is cancelled', async () => {
    vi.spyOn(axios, 'post').mockRejectedValue(httpError(409))
    const user = renderForm()
    let dialog = await openDialog(user)
    await fillForm(user, valid)
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }))
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    dialog = await openDialog(user)
    expectEmptyForm(dialog)
  })

  it('starts empty after a server error, with no leftover form-level alert', async () => {
    vi.spyOn(axios, 'post').mockRejectedValue(httpError(500))
    const user = renderForm()
    let dialog = await openDialog(user)
    await fillForm(user, valid)
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("Couldn't create user")

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    dialog = await openDialog(user)
    expectEmptyForm(dialog)
  })

  it('discards typed input and validation errors on cancel', async () => {
    const post = vi.spyOn(axios, 'post')
    const user = renderForm()
    let dialog = await openDialog(user)
    await fillForm(user, { name: 'Al', email: 'grace@example.com', password: '' })
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }))
    expect(within(dialog).getAllByRole('alert')).toHaveLength(2)

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    dialog = await openDialog(user)
    expectEmptyForm(dialog)
    expect(post).not.toHaveBeenCalled()
  })
})

const existing: User = {
  id: '2',
  name: 'Alan Agent',
  email: 'agent@example.com',
  role: Role.agent,
  createdAt: '2026-03-02T12:00:00.000Z',
}

function renderEditForm() {
  const user = userEvent.setup()
  renderWithQuery(<UserForm user={existing} />)
  return user
}

async function openEditDialog(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: 'Edit Alan Agent' }))
  return screen.getByRole('dialog', { name: 'Edit user' })
}

describe('UserForm edit', () => {
  it('opens with the user\'s name and email filled in and a blank password', async () => {
    const user = renderEditForm()
    const dialog = await openEditDialog(user)

    expect(dialog).toHaveAccessibleDescription('Leave the password blank to keep the current one.')
    expect(screen.getByLabelText('Name')).toHaveValue('Alan Agent')
    expect(screen.getByLabelText('Email')).toHaveValue('agent@example.com')
    expect(screen.getByLabelText('Password')).toHaveValue('')
    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeEnabled()
  })

  it('sends a PATCH without a password when it is left blank, refetches the users list and closes', async () => {
    const get = vi.spyOn(axios, 'get').mockResolvedValue({ data: { users: [] } })
    const patch = vi
      .spyOn(axios, 'patch')
      .mockResolvedValue({ data: { user: { ...existing, name: 'Alan Turing' } } })
    const user = userEvent.setup()
    renderWithQuery(
      <>
        <UsersQuery />
        <UserForm user={existing} />
      </>,
    )
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))

    const dialog = await openEditDialog(user)
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), '  Alan Turing ')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(patch).toHaveBeenCalledWith('/api/users/2', { name: 'Alan Turing', email: 'agent@example.com' })
    // The schema leaves password as undefined; axios serialises the body as JSON, which drops it.
    expect(JSON.stringify(patch.mock.calls[0]![1])).not.toContain('password')
    expect(get).toHaveBeenCalledTimes(2)
    expect(get).toHaveBeenLastCalledWith('/api/users')
  })

  it('includes a new password in the PATCH body', async () => {
    const patch = vi.spyOn(axios, 'patch').mockResolvedValue({ data: { user: existing } })
    const user = renderEditForm()
    const dialog = await openEditDialog(user)
    await user.type(screen.getByLabelText('Password'), 'new-password')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(patch).toHaveBeenCalledWith('/api/users/2', {
      name: 'Alan Agent',
      email: 'agent@example.com',
      password: 'new-password',
    })
  })

  it('rejects a short new password without sending a request', async () => {
    const patch = vi.spyOn(axios, 'patch')
    const user = renderEditForm()
    const dialog = await openEditDialog(user)
    await user.type(screen.getByLabelText('Password'), 'short')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(within(dialog).getByRole('alert')).toHaveTextContent(/^Password must be at least 8 characters$/)
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'false')
    expect(patch).not.toHaveBeenCalled()
  })

  it('disables the submit button and shows "Saving…" while pending', async () => {
    vi.spyOn(axios, 'patch').mockReturnValue(new Promise(() => {}))
    const user = renderEditForm()
    const dialog = await openEditDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(await within(dialog).findByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })
})

describe('UserForm edit server errors', () => {
  async function submitWith(error: AxiosError) {
    vi.spyOn(axios, 'patch').mockRejectedValue(error)
    const user = renderEditForm()
    const dialog = await openEditDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    return dialog
  }

  it('shows the server message under the email field on 409', async () => {
    const dialog = await submitWith(httpError(409, { error: 'A user with this email already exists' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /^A user with this email already exists$/,
    )
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'false')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('falls back to "Couldn\'t update user" in a form-level alert on other errors', async () => {
    const dialog = await submitWith(new AxiosError('Network Error', 'ERR_NETWORK'))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/^Couldn't update user$/)
    for (const label of ['Name', 'Email', 'Password']) {
      expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'false')
    }
  })
})

describe('UserForm edit reopening', () => {
  it('shows the user\'s original values again after edits are cancelled', async () => {
    const patch = vi.spyOn(axios, 'patch')
    const user = renderEditForm()
    let dialog = await openEditDialog(user)
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Al')
    await user.clear(screen.getByLabelText('Email'))
    await user.type(screen.getByLabelText('Email'), 'other@example.com')
    await user.type(screen.getByLabelText('Password'), 'short')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(within(dialog).getAllByRole('alert')).toHaveLength(2)

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    dialog = await openEditDialog(user)
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Alan Agent')
    expect(screen.getByLabelText('Email')).toHaveValue('agent@example.com')
    expect(screen.getByLabelText('Password')).toHaveValue('')
    for (const label of ['Name', 'Email', 'Password']) {
      expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'false')
    }
    expect(patch).not.toHaveBeenCalled()
  })
})
