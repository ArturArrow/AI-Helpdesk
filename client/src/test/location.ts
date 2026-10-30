import { screen } from '@testing-library/react'

// Read what <LocationProbe /> (./LocationProbe.tsx) shows.
export function urlSearch() {
  return screen.getByRole('status', { name: 'URL search' }).textContent
}

export function navigationType() {
  return screen.getByRole('status', { name: 'Navigation type' }).textContent
}
