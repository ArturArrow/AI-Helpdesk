import * as Sentry from '@sentry/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, type ErrorInfo } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import ErrorFallback from './components/ErrorFallback.tsx'

// Error reporting. Optional: without VITE_SENTRY_DSN the SDK is disabled and sends nothing.
// Errors only: no tracing and no session replay, which would record customer emails on screen.
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  // Where it runs, set apart from Vite's mode (a staging build is a production build too).
  // Built into the bundle, so each environment needs its own build.
  environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
})

// No automatic retries: the default (3, with backoff) keeps a failed request in its
// loading state for ~7s, and our API's 4xx/5xx answers won't change on a quick retry.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})

// React 19's root error hooks: every render error reaches Sentry, caught by a boundary or not.
// A handler replaces React's own, which is what logs the error to the console, so in development
// each one logs it again. A production build (vite build) logs nothing: the error goes only to
// Sentry. This follows the build, not VITE_SENTRY_ENVIRONMENT, which only labels the events.
// An error the Sentry boundaries already reported isn't sent twice: the SDK skips an error
// object it has seen.
const logError = import.meta.env.DEV
  ? (error: unknown, errorInfo: ErrorInfo) => console.error(error, errorInfo.componentStack)
  : undefined
createRoot(document.getElementById('root')!, {
  onUncaughtError: Sentry.reactErrorHandler(logError),
  onCaughtError: Sentry.reactErrorHandler(logError),
  onRecoverableError: Sentry.reactErrorHandler(logError),
}).render(
  <StrictMode>
    {/* Last resort, for what ProtectedLayout's boundary doesn't cover: the login page, the
        navbar, the layout itself. */}
    <Sentry.ErrorBoundary
      fallback={({ resetError }) => (
        <div className="mx-auto max-w-xl px-4 py-16">
          <ErrorFallback onRetry={resetError} />
        </div>
      )}
    >
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
