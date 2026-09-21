import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library only unmounts automatically when the runner exposes a global afterEach,
// which Vitest doesn't without `globals: true`.
afterEach(cleanup)
