import { execSync } from 'node:child_process'
import { AGENT } from './fixtures/auth.js'

// Runs after webServer is up (Playwright starts webServer first) and before any test.
// --env-file loads only server/.env.test, never .env.
const run = (cmd: string, env: NodeJS.ProcessEnv = {}) =>
  execSync(`bun --env-file=.env.test run ${cmd}`, {
    cwd: 'server',
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })

export default function globalSetup() {
  run('scripts/assert-test-db.ts') // refuse anything but a *_test database
  run('prisma migrate reset --force') // drop + re-migrate helpdesk_test
  run('prisma/seed.ts') // admin from .env.test (Prisma 7 no longer seeds on reset)
  run('../e2e/seed-agent.ts', {
    E2E_AGENT_EMAIL: AGENT.email,
    E2E_AGENT_PASSWORD: AGENT.password,
    E2E_AGENT_NAME: AGENT.name,
  })
}
