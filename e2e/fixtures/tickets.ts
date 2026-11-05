import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, type APIRequestContext } from '@playwright/test'
import { uniqueSuffix } from './users.js'
import { inboundSecret } from './webhook.js'

export type CreatedTicket = {
  id: number
  subject: string
  senderName: string
  senderEmail: string
}

// A file as the webhook takes it. Without `content` it's one the mailer left out for being too large.
export type InboundAttachment = {
  filename: string
  contentType?: string
  size: number
  contentId?: string
  content?: string
}

// A file as the ticket and reply endpoints list it.
export type ListedAttachment = {
  id: number
  filename: string
  contentType: string
  size: number
  contentId: string | null
  tooLarge: boolean
}

// A file with these bytes, in the shape the webhook takes.
export function fileAttachment(filename: string, contentType: string, bytes: Buffer): InboundAttachment {
  return { filename, contentType, size: bytes.length, content: bytes.toString('base64') }
}

// Creates a ticket through the inbound-email webhook (the only way to create one so far).
// Subject and sender are unique per call, so tests can find their own rows among other specs'.
// `overrides` sets any of these fields exactly, for tests that sort or search on them. No bodyHTML
// is sent unless an override sets one, so the ticket's bodyHTML is null by default. A `messageId`
// override lets a later email thread onto the ticket.
export async function createTicketViaWebhook(
  request: APIRequestContext,
  label = 'ticket',
  overrides: {
    subject?: string
    senderName?: string
    senderEmail?: string
    body?: string
    bodyHTML?: string
    messageId?: string
    attachments?: InboundAttachment[]
  } = {},
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

export type TicketUpdate = {
  assignedToId?: string | null
  status?: string
  category?: string | null
}

// Updates a ticket through PATCH /api/tickets/:id (any of assignedToId, status, category; null
// unassigns or unclassifies), asserts 200 and returns the ticket. `request` must be signed in
// (as anyone).
export async function updateTicketViaApi(request: APIRequestContext, ticketId: number, data: TicketUpdate) {
  const res = await request.patch(`/api/tickets/${ticketId}`, { data })
  expect(res.status(), `update ticket ${ticketId} with ${JSON.stringify(data)}`).toBe(200)
  return (await res.json()).ticket
}

// Runs e2e/write-ticket.ts like global-setup's steps: from server/, with only .env.test loaded.
function writeTicketInDb(env: Record<string, string>) {
  execSync('bun --env-file=.env.test run ../e2e/write-ticket.ts', {
    cwd: fileURLToPath(new URL('../../server', import.meta.url)),
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
}

// Sets a ticket's status directly in helpdesk_test. For `new` and `processing`, which only the
// AI pipeline sets (the API accepts only open, resolved, closed, and E2E runs without the key).
export function setTicketStatusInDb(ticketId: number, status: string) {
  writeTicketInDb({ E2E_TICKET_ID: String(ticketId), E2E_TICKET_STATUS: status })
}

// Writes any of status, createdAt, resolvedAt and assignedToId (null clears either) directly in
// helpdesk_test, for tests that need known resolution times or a ticket held by the AI system
// agent (which PATCH refuses). Fields left out are unchanged; it doesn't apply the API's
// resolvedAt rules or check the assignee.
export function setTicketInDb(
  ticketId: number,
  fields: { status?: string; createdAt?: Date; resolvedAt?: Date | null; assignedToId?: string | null },
) {
  const env: Record<string, string> = { E2E_TICKET_ID: String(ticketId) }
  if (fields.status) env.E2E_TICKET_STATUS = fields.status
  if (fields.createdAt) env.E2E_TICKET_CREATED_AT = fields.createdAt.toISOString()
  if (fields.resolvedAt !== undefined) {
    env.E2E_TICKET_RESOLVED_AT = fields.resolvedAt === null ? 'null' : fields.resolvedAt.toISOString()
  }
  if (fields.assignedToId !== undefined) env.E2E_TICKET_ASSIGNED_TO_ID = fields.assignedToId ?? 'null'
  writeTicketInDb(env)
}

// Deletes every ticket (and so every reply) in helpdesk_test. Only for tests of global numbers
// like GET /api/tickets/stats; every other test finds its own rows by unique values instead.
export function deleteAllTicketsInDb() {
  writeTicketInDb({ E2E_DELETE_ALL_TICKETS: '1' })
}

// Adds a `sender: ai` reply (authored by the AI system agent, no bodyHTML) to a ticket directly in
// helpdesk_test, as the AI pipeline does when it resolves a ticket.
export function addAiReplyInDb(ticketId: number, body: string) {
  writeTicketInDb({ E2E_TICKET_ID: String(ticketId), E2E_AI_REPLY_BODY: body })
}
