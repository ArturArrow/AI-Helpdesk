import { execSync } from 'node:child_process'

// Runs after webServer is up (Playwright starts webServer first) and before any test.
// --env-file loads only server/.env.test, never .env.
const run = (cmd: string) =>
  execSync(`bun --env-file=.env.test run ${cmd}`, { cwd: 'server', stdio: 'inherit' })

export default function globalSetup() {
  run('scripts/assert-test-db.ts') // refuse anything but a *_test database
  run('prisma migrate reset --force') // drop + re-migrate helpdesk_test
  run('prisma/seed.ts') // admin from .env.test (Prisma 7 no longer seeds on reset)
}
