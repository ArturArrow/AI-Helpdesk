import { defineConfig, devices } from '@playwright/test'

// Tests run against their own server (3101) and client (5174), backed by the helpdesk_test
// database from server/.env.test, so a running dev stack on 3001/5173 is left alone.
export default defineConfig({
  testDir: './e2e/tests',
  outputDir: './e2e/test-results',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  // One shared database, reset once per run by globalSetup.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      name: 'server',
      command: 'bun run start:test',
      cwd: 'server',
      url: 'http://localhost:3101/api/health',
      // Never reuse: always start fresh from server/.env.test, not attach to whatever holds the port.
      reuseExistingServer: false,
    },
    {
      name: 'client',
      command: 'bun run dev --port 5174 --strictPort',
      cwd: 'client',
      url: 'http://localhost:5174',
      env: { API_URL: 'http://localhost:3101' },
      reuseExistingServer: false,
    },
  ],
})
