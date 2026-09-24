import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderOptions } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'

// A fresh client per call, so no cached result leaks between tests; no retries, as in main.tsx.
export function renderWithQuery(ui: ReactNode, options?: Omit<RenderOptions, 'wrapper'>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(ui, {
    ...options,
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })
}

// renderWithQuery inside a MemoryRouter that starts at `route`. Pass <Routes> as `ui` to
// observe navigation.
export function renderWithRouter(ui: ReactNode, route = '/') {
  return renderWithQuery(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>)
}
