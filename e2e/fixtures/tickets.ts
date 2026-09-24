import { expect, type APIRequestContext } from '@playwright/test'
import { uniqueSuffix } from './users.js'
import { inboundSecret } from './webhook.js'

export type CreatedTicket = {
  id: number
  subject: string
  senderName: string
  senderEmail: string
}

// Creates a ticket through the inbound-email webhook (the only way to create one so far).
// Subject and sender are unique per call, so tests can find their own rows among other specs'.
// `overrides` sets the subject or sender name exactly, for tests that sort on them.
export async function createTicketViaWebhook(
  request: APIRequestContext,
  label = 'ticket',
  overrides: { subject?: string; senderName?: string } = {},
): Promise<CreatedTicket> {
  const suffix = uniqueSuffix()
  const data = {
    subject: `E2E ${label} ${suffix}`,
    senderName: `Customer ${suffix}`,
    senderEmail: `customer-${suffix}@example.com`,
    body: 'Please help.',
    ...overrides,
  }
  const res = await request.post('/api/webhooks/inbound-email', {
    headers: { 'X-Inbound-Secret': inboundSecret() },
    data,
  })
  expect(res.status(), `create ticket ${data.subject}`).toBe(201)
  const { ticket } = await res.json()
  return { id: ticket.id, subject: data.subject, senderName: data.senderName, senderEmail: data.senderEmail }
}
