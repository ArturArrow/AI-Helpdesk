import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { authClient } from '../lib/auth-client.ts'

type NavbarProps = {
  userName: string
  isAdmin: boolean
}

function Navbar({ userName, isAdmin }: NavbarProps) {
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    setSigningOut(true)
    await authClient.signOut()
    navigate('/login', { replace: true })
  }

  return (
    <header className="border-b border-gray-200 bg-white">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <Link to="/" className="text-lg font-semibold text-gray-900">
            Helpdesk
          </Link>
          <Link
            to="/tickets"
            className="text-sm font-medium text-gray-700 hover:text-gray-900"
          >
            Tickets
          </Link>
          {isAdmin && (
            <>
              <Link
                to="/users"
                className="text-sm font-medium text-gray-700 hover:text-gray-900"
              >
                Users
              </Link>
              <Link
                to="/rag"
                className="text-sm font-medium text-gray-700 hover:text-gray-900"
              >
                Knowledge base
              </Link>
            </>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-700">{userName}</span>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </nav>
    </header>
  )
}

export default Navbar
