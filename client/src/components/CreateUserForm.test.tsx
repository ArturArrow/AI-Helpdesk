import { useQuery } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import axios, { AxiosError, type AxiosResponse } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '@/test/render.tsx'
import CreateUserForm from './CreateUserForm.tsx'

const created = {
  user: {
    id: '3',
    name: 'Grace Hopper',
    email: 'grace@example.com',
    role: 'agent',
    createdAt: '2026-09-01T12:00:00.000Z',
  },
}

// Stands in for UsersPage: an active ['users'] query, so invalidation shows up as a refetch.
function UsersQuery() {
  useQuery({ queryKey: ['users'], queryFn: () => axios.get('/api/users') })
  return null
}

function httpError(status: number, data?: { error: string }) {
  return new AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_REQUEST',
    undefined,
    undefined,
    { status, data } as AxiosResponse,
  )
}

function renderForm() {
  const user = userEvent.setup()
  renderWithQuery(<CreateUserForm />)
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

describe('CreateUserForm validation', () => {
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

describe('CreateUserForm submit', () => {
  it('posts the parsed values, refetches the users list and closes', async () => {
    const get = vi.spyOn(axios, 'get').mockResolvedValue({ data: { users: [] } })
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: created })
    const user = userEvent.setup()
    renderWithQuery(
      <>
        <UsersQuery />
        <CreateUserForm />
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

describe('CreateUserForm server errors', () => {
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

describe('CreateUserForm reopening', () => {
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
