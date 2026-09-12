import { useEffect, useState } from 'react'
import './App.css'

function App() {
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => setStatus(data.status === 'ok' ? 'ok' : 'error'))
      .catch(() => setStatus('error'))
  }, [])

  return (
    <main className="app">
      <h1>Ticket Management System</h1>
      <p>
        Server status:{' '}
        <span className={`status status-${status}`}>{status}</span>
      </p>
    </main>
  )
}

export default App
