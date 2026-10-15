import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

// The shared secret the server checks on /api/webhooks/*. Read from server/.env.test, the same
// file start:test loads, so the tests and the server can't disagree. Read lazily, so a missing
// value fails the webhook tests with a clear message instead of breaking every spec at import.
export function inboundSecret(): string {
  const env = parseEnv(readFileSync(new URL('../../server/.env.test', import.meta.url), 'utf8'))
  const secret = env.INBOUND_EMAIL_SECRET
  if (!secret) throw new Error('INBOUND_EMAIL_SECRET is not set in server/.env.test')
  return secret
}
