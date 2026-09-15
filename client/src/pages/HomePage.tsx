import { authClient } from '../lib/auth-client.ts'

function HomePage() {
  const { data: session } = authClient.useSession()

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">
        Welcome, {session?.user.name}
      </h1>
      <p className="mt-2 text-gray-600">Tickets and the dashboard are coming soon.</p>
    </div>
  )
}

export default HomePage
