import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { authClient } from '@/lib/auth-client.ts'
import { renderWithRouter } from '@/test/render.tsx'
import Navbar from './Navbar.tsx'

vi.mock('@/lib/auth-client.ts', () => ({ authClient: { signOut: vi.fn() } }))

afterEach(() => {
  vi.resetAllMocks()
})

// Navbar at / plus a stand-in login page, so the redirect after signing out shows up.
function renderNavbar(isAdmin: boolean) {
  const user = userEvent.setup()
  renderWithRouter(
    <Routes>
      <Route path="/" element={<Navbar userName="Ada Admin" isAdmin={isAdmin} />} />
      <Route path="/login" element={<h1>Login page</h1>} />
    </Routes>,
  )
  return user
}

describe('Navbar', () => {
  it('shows the Users link to admins', () => {
    renderNavbar(true)

    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('href', '/users')
  })

  it('hides the Users link from agents', () => {
    renderNavbar(false)

    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument()
  })

  it('shows the Helpdesk home link and the user name', () => {
    renderNavbar(false)

    expect(screen.getByRole('link', { name: 'Helpdesk' })).toHaveAttribute('href', '/')
    expect(screen.getByText('Ada Admin')).toBeInTheDocument()
  })

  it('signs out, showing progress, then navigates to /login', async () => {
    let finishSignOut!: () => void
    vi.mocked(authClient.signOut).mockReturnValue(
      new Promise((resolve) => {
        finishSignOut = () => resolve({ data: { success: true }, error: null })
      }),
    )
    const user = renderNavbar(false)

    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(authClient.signOut).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Signing out…' })).toBeDisabled()
    expect(screen.queryByRole('heading', { name: 'Login page' })).not.toBeInTheDocument()

    finishSignOut()

    expect(await screen.findByRole('heading', { name: 'Login page' })).toBeInTheDocument()
  })
})
