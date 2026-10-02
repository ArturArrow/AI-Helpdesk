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
// `overrides` sets any of the four fields exactly, for tests that sort or search on them.
export async function createTicketViaWebhook(
  request: APIRequestContext,
  label = 'ticket',
  overrides: { subject?: string; senderName?: string; senderEmail?: string; body?: string } = {},
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

// Assigns a ticket through PATCH /api/tickets/:id (null unassigns), asserts 200 and returns the
// ticket. `request` must be signed in (as anyone).
export async function assignTicketViaApi(request: APIRequestContext, ticketId: number, assignedToId: string | null) {
  const res = await request.patch(`/api/tickets/${ticketId}`, { data: { assignedToId } })
  expect(res.status(), `assign ticket ${ticketId} to ${assignedToId}`).toBe(200)
  return (await res.json()).ticket
}
