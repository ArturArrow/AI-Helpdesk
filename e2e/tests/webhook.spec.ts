import { randomBytes } from 'node:crypto'
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { ADMIN, signInViaApi } from '../fixtures/auth.js'
import { AI_AGENT, createUserViaApi, uniqueSuffix } from '../fixtures/users.js'
import { inboundSecret } from '../fixtures/webhook.js'
import { fileAttachment, setTicketInDb, updateTicketViaApi, type ListedAttachment } from '../fixtures/tickets.js'

// The route answers with `{ ticket: { id } }` (plus `reply: { id }` for a threaded email), so most
// tests check the wire response. The stored list fields are checked through GET /api/tickets in
// tickets.spec.ts; the threading tests read the stored replies and status back through the API.

const ENDPOINT = '/api/webhooks/inbound-email'
const MiB = 1024 * 1024

// A valid body with a unique sender, so tests never share data.
function validEmail() {
  const suffix = uniqueSuffix()
  return {
    senderEmail: `customer-${suffix}@example.com`,
    senderName: `Customer ${suffix}`,
    subject: 'Printer on fire',
    body: 'It is still burning.',
  }
}

const uniqueMessageId = (label: string) => `<${label}-${uniqueSuffix()}@example.com>`

function postInbound(request: APIRequestContext, data: unknown, secret: string | null = inboundSecret()) {
  return request.post(ENDPOINT, {
    headers: secret === null ? {} : { 'X-Inbound-Secret': secret },
    data,
  })
}

async function expectUnauthorized(res: APIResponse) {
  expect(res.status()).toBe(401)
  expect(await res.json()).toEqual({ error: 'Unauthorized' })
}

async function expectCreated(res: APIResponse): Promise<number> {
  expect(res.status()).toBe(201)
  const json = await res.json()
  expect(json).toEqual({ ticket: { id: expect.any(Number) } })
  return json.ticket.id
}

test.describe('POST /api/webhooks/inbound-email: auth', () => {
  test('401 without the X-Inbound-Secret header', async ({ request }) => {
    await expectUnauthorized(await postInbound(request, validEmail(), null))
  })

  test('401 with a wrong secret', async ({ request }) => {
    await expectUnauthorized(await postInbound(request, validEmail(), 'wrong-secret'))
  })

  test('401 with a wrong secret of the same length', async ({ request }) => {
    const secret = inboundSecret()
    const last = secret.at(-1) === 'x' ? 'y' : 'x'
    const sameLength = secret.slice(0, -1) + last
    expect(sameLength).toHaveLength(secret.length)
    await expectUnauthorized(await postInbound(request, validEmail(), sameLength))
  })

  test('401 for a signed-in admin without the secret: a session does not count', async ({ request }) => {
    await signInViaApi(request, ADMIN)
    const me = await request.get('/api/me')
    expect(me.status(), 'the session itself is valid').toBe(200)

    await expectUnauthorized(await postInbound(request, validEmail(), null))
  })
})

test.describe('POST /api/webhooks/inbound-email: creating tickets', () => {
  test('201 with the new ticket id for a valid email', async ({ request }) => {
    await expectCreated(await postInbound(request, validEmail()))
  })

  test('201 without a subject', async ({ request }) => {
    const { subject: _subject, ...data } = validEmail()
    await expectCreated(await postInbound(request, data))
  })

  test('201 with a blank subject', async ({ request }) => {
    await expectCreated(await postInbound(request, { ...validEmail(), subject: '   ' }))
  })

  // E2E runs without OPENAI_API_KEY; with it, a new ticket would start as new and held by the AI.
  test('without the AI configured, a new ticket is open and unassigned', async ({ request }) => {
    const id = await expectCreated(await postInbound(request, validEmail()))

    await signInViaApi(request, ADMIN)
    expect(await getTicket(request, id)).toMatchObject({ status: 'open', assignedTo: null })
  })

  test('201 with the optional bodyHTML and messageId', async ({ request }) => {
    await expectCreated(
      await postInbound(request, {
        ...validEmail(),
        bodyHTML: '<p>It is still burning.</p>',
        messageId: uniqueMessageId('optional'),
      }),
    )
  })
})

test.describe('POST /api/webhooks/inbound-email: dedupe', () => {
  test('a repeated messageId returns the existing ticket with 200', async ({ request }) => {
    const data = { ...validEmail(), messageId: uniqueMessageId('dedupe') }

    const id = await expectCreated(await postInbound(request, data))

    const again = await postInbound(request, data)
    expect(again.status()).toBe(200)
    expect(await again.json()).toEqual({ ticket: { id } })
  })

  test('two concurrent posts with the same new messageId both return one ticket', async ({ request }) => {
    const data = { ...validEmail(), messageId: uniqueMessageId('race') }

    const [a, b] = await Promise.all([postInbound(request, data), postInbound(request, data)])

    // Exactly one insert wins; the other gets the existing ticket (by lookup or the P2002 fallback).
    expect([a.status(), b.status()].sort()).toEqual([200, 201])
    const [aJson, bJson] = [await a.json(), await b.json()]
    expect(aJson).toEqual({ ticket: { id: expect.any(Number) } })
    expect(bJson).toEqual({ ticket: { id: aJson.ticket.id } })
  })

  test('posts without a messageId are never deduped', async ({ request }) => {
    const data = validEmail()
    const first = await expectCreated(await postInbound(request, data))
    const second = await expectCreated(await postInbound(request, data))
    expect(second).not.toBe(first)
  })
})

// A ticket with a known messageId, to thread replies onto.
async function createThreadTicket(request: APIRequestContext, label: string) {
  const messageId = uniqueMessageId(label)
  const id = await expectCreated(await postInbound(request, { ...validEmail(), messageId }))
  return { id, messageId }
}

// A customer's answer with a unique token in its subject and sender, so a test can check through
// the list search that it created no ticket of its own.
function replyEmail(threading: { inReplyTo?: string; references?: string[] }) {
  const token = `thread-${uniqueSuffix()}`
  return {
    token,
    data: {
      senderEmail: `${token}@example.com`,
      senderName: `Customer ${token}`,
      subject: `Re: ${token}`,
      body: `Still broken (${token}).`,
      bodyHTML: `<p>Still broken (<b>${token}</b>).</p>`,
      messageId: uniqueMessageId('reply'),
      ...threading,
    },
  }
}

async function expectReplyCreated(res: APIResponse, ticketId: number): Promise<number> {
  expect(res.status()).toBe(201)
  const json = await res.json()
  expect(json).toEqual({ ticket: { id: ticketId }, reply: { id: expect.any(Number) } })
  return json.reply.id
}

// GET /api/tickets/:id/replies; `request` must be signed in.
async function listReplies(request: APIRequestContext, ticketId: number) {
  const res = await request.get(`/api/tickets/${ticketId}/replies`)
  expect(res.status()).toBe(200)
  return (await res.json()).replies
}

// GET /api/tickets/:id; `request` must be signed in.
async function getTicket(request: APIRequestContext, ticketId: number) {
  const res = await request.get(`/api/tickets/${ticketId}`)
  expect(res.status()).toBe(200)
  return (await res.json()).ticket
}

async function ticketStatus(request: APIRequestContext, ticketId: number): Promise<string> {
  return (await getTicket(request, ticketId)).status
}

// The webhook only returns ids, so check through GET /api/tickets that no ticket holds `marker`
// in its subject, sender name, sender email or body. Signs `request` in as the admin.
async function expectNoTicketMatching(request: APIRequestContext, marker: string) {
  await signInViaApi(request, ADMIN)
  const res = await request.get('/api/tickets', { params: { q: marker } })
  expect(res.status()).toBe(200)
  expect(await res.json()).toEqual({ tickets: [], total: 0 })
}

test.describe('POST /api/webhooks/inbound-email: threading replies', () => {
  test('inReplyTo naming a ticket stores a customer reply on it (emailStatus and sentAt null), not a new ticket', async ({ request }) => {
    const ticket = await createThreadTicket(request, 'thread-root')
    const { token, data } = replyEmail({ inReplyTo: ticket.messageId })

    const replyId = await expectReplyCreated(await postInbound(request, data), ticket.id)

    await expectNoTicketMatching(request, token)
    expect(await listReplies(request, ticket.id)).toEqual([
      {
        id: replyId,
        body: data.body,
        bodyHTML: data.bodyHTML,
        sender: 'customer',
        emailStatus: null,
        sentAt: null,
        author: null,
        createdAt: expect.any(String),
        attachments: [],
      },
    ])
  })

  test('a match in references alone threads the reply', async ({ request }) => {
    const ticket = await createThreadTicket(request, 'thread-refs')
    const { token, data } = replyEmail({ references: [uniqueMessageId('unknown'), ticket.messageId] })

    const replyId = await expectReplyCreated(await postInbound(request, data), ticket.id)

    await expectNoTicketMatching(request, token)
    const replies = await listReplies(request, ticket.id)
    expect(replies.map((r: { id: number }) => r.id)).toEqual([replyId])
  })

  test('an answer to an earlier customer reply threads to the same ticket', async ({ request }) => {
    const ticket = await createThreadTicket(request, 'thread-chain')
    const first = replyEmail({ inReplyTo: ticket.messageId })
    const firstId = await expectReplyCreated(await postInbound(request, first.data), ticket.id)

    const second = replyEmail({ inReplyTo: first.data.messageId })
    const secondId = await expectReplyCreated(await postInbound(request, second.data), ticket.id)

    await expectNoTicketMatching(request, second.token)
    const replies = await listReplies(request, ticket.id)
    expect(replies.map((r: { id: number }) => r.id)).toEqual([firstId, secondId])
    expect(replies[1]).toMatchObject({ body: second.data.body, sender: 'customer', author: null })
  })

  test('a redelivered reply returns the stored one with 200 and is stored once', async ({ request }) => {
    const ticket = await createThreadTicket(request, 'thread-dedupe')
    const { data } = replyEmail({ inReplyTo: ticket.messageId })
    const replyId = await expectReplyCreated(await postInbound(request, data), ticket.id)

    const again = await postInbound(request, data)
    expect(again.status()).toBe(200)
    expect(await again.json()).toEqual({ ticket: { id: ticket.id }, reply: { id: replyId } })

    await signInViaApi(request, ADMIN)
    expect(await listReplies(request, ticket.id)).toHaveLength(1)
  })

  test('a customer reply reopens a resolved ticket', async ({ request }) => {
    const ticket = await createThreadTicket(request, 'thread-reopen')
    await signInViaApi(request, ADMIN)
    await updateTicketViaApi(request, ticket.id, { status: 'resolved' })
    expect(await ticketStatus(request, ticket.id)).toBe('resolved')

    const { data } = replyEmail({ inReplyTo: ticket.messageId })
    await expectReplyCreated(await postInbound(request, data), ticket.id)

    expect(await ticketStatus(request, ticket.id)).toBe('open')
  })

  // Only the AI pipeline assigns the AI (needs OPENAI_API_KEY), so the assignment is written to the DB.
  test('a customer reply on a resolved ticket held by the AI reopens it and unassigns the AI', async ({ request }) => {
    const ticket = await createThreadTicket(request, 'thread-ai')
    setTicketInDb(ticket.id, { status: 'resolved', resolvedAt: new Date(), assignedToId: AI_AGENT.id })
    await signInViaApi(request, ADMIN)
    expect(await getTicket(request, ticket.id)).toMatchObject({
      status: 'resolved',
      assignedTo: { id: AI_AGENT.id, name: AI_AGENT.name },
    })

    const { data } = replyEmail({ inReplyTo: ticket.messageId })
    await expectReplyCreated(await postInbound(request, data), ticket.id)

    expect(await getTicket(request, ticket.id)).toMatchObject({ status: 'open', assignedTo: null })
  })

  test('a customer reply on a resolved ticket held by an agent reopens it and keeps the agent', async ({ request }) => {
    const ticket = await createThreadTicket(request, 'thread-agent')
    await signInViaApi(request, ADMIN)
    const agent = await createUserViaApi(request, 'thread-assignee')
    await updateTicketViaApi(request, ticket.id, { assignedToId: agent.id, status: 'resolved' })

    const { data } = replyEmail({ inReplyTo: ticket.messageId })
    await expectReplyCreated(await postInbound(request, data), ticket.id)

    expect(await getTicket(request, ticket.id)).toMatchObject({
      status: 'open',
      assignedTo: { id: agent.id, name: agent.name },
    })
  })

  test('a customer reply leaves an open ticket open', async ({ request }) => {
    const ticket = await createThreadTicket(request, 'thread-open')
    const { data } = replyEmail({ inReplyTo: ticket.messageId })
    await expectReplyCreated(await postInbound(request, data), ticket.id)

    await signInViaApi(request, ADMIN)
    expect(await ticketStatus(request, ticket.id)).toBe('open')
  })

  test('an unknown inReplyTo creates a new ticket', async ({ request }) => {
    const ticket = await createThreadTicket(request, 'thread-unknown')
    const { data } = replyEmail({ inReplyTo: uniqueMessageId('unknown') })

    const id = await expectCreated(await postInbound(request, data))
    expect(id).not.toBe(ticket.id)

    await signInViaApi(request, ADMIN)
    expect(await listReplies(request, ticket.id)).toEqual([])
    expect(await listReplies(request, id)).toEqual([])
  })
})

test.describe('POST /api/webhooks/inbound-email: validation', () => {
  const cases: [string, (email: ReturnType<typeof validEmail>) => object, string][] = [
    ['missing senderEmail', ({ senderEmail: _, ...rest }) => rest, 'senderEmail is required'],
    ['invalid senderEmail', (email) => ({ ...email, senderEmail: 'not-an-email' }), 'senderEmail must be a valid email address'],
    ['missing senderName', ({ senderName: _, ...rest }) => rest, 'senderName is required'],
    ['missing body', ({ body: _, ...rest }) => rest, 'body is required'],
    ['references not an array', (email) => ({ ...email, references: '<a@example.com>' }), 'references must be an array of Message-IDs'],
  ]

  for (const [label, build, error] of cases) {
    test(`400 for ${label}`, async ({ request }) => {
      const res = await postInbound(request, build(validEmail()))
      expect(res.status()).toBe(400)
      expect(await res.json()).toEqual({ error })
    })
  }

  test('malformed JSON gets a JSON 400, not an HTML stack trace', async ({ request }) => {
    const res = await request.post(ENDPOINT, {
      headers: { 'X-Inbound-Secret': inboundSecret(), 'Content-Type': 'application/json' },
      data: '{"senderEmail": "broken',
    })
    expect(res.status()).toBe(400)
    expect(res.headers()['content-type']).toContain('application/json')
    const text = await res.text()
    expect(text).not.toContain('<')
    expect(text).not.toMatch(/\bat \S+ \(/) // no stack frames
    expect(JSON.parse(text)).toEqual({ error: expect.any(String) })
  })
})

// A valid address of exactly `length` characters (RFC 5321 caps it at 254): a local part starting
// with a unique tag (64 chars at 254), and a fixed domain of labels no longer than 63 each.
// Only the local part grows, so the only thing wrong with 255 is the length.
function emailOfLength(length: number) {
  const domain = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(57)}.com`
  expect(domain).toHaveLength(189)
  const local = `max-${uniqueSuffix()}-`.padEnd(length - domain.length - 1, 'x')
  const email = `${local}@${domain}`
  expect(email).toHaveLength(length)
  return email
}

async function expectTooLong(res: APIResponse, error: string) {
  expect(res.status()).toBe(400)
  expect(await res.json()).toEqual({ error })
}

test.describe('POST /api/webhooks/inbound-email: length limits', () => {
  test('400 for a 255-character senderEmail, and no ticket is stored', async ({ request }) => {
    const senderEmail = emailOfLength(255)
    const subject = `Too long email ${uniqueSuffix()}`
    await expectTooLong(await postInbound(request, { ...validEmail(), senderEmail, subject }), 'senderEmail is too long')
    await expectNoTicketMatching(request, subject)
  })

  test('201 for a 254-character senderEmail, stored in full', async ({ request }) => {
    const senderEmail = emailOfLength(254)
    const id = await expectCreated(await postInbound(request, { ...validEmail(), senderEmail }))

    await signInViaApi(request, ADMIN)
    const res = await request.get(`/api/tickets/${id}`)
    expect(res.status()).toBe(200)
    expect((await res.json()).ticket.senderEmail).toBe(senderEmail)
  })

  test('400 for a 999-character senderName, and no ticket is stored', async ({ request }) => {
    const subject = `Too long name ${uniqueSuffix()}`
    const senderName = 'n'.repeat(999)
    await expectTooLong(await postInbound(request, { ...validEmail(), senderName, subject }), 'senderName is too long')
    await expectNoTicketMatching(request, subject)
  })

  test('201 for a 998-character senderName, stored in full', async ({ request }) => {
    const senderName = `Customer ${uniqueSuffix()} `.padEnd(998, 'n')
    expect(senderName).toHaveLength(998)
    const id = await expectCreated(await postInbound(request, { ...validEmail(), senderName }))

    await signInViaApi(request, ADMIN)
    const res = await request.get(`/api/tickets/${id}`)
    expect(res.status()).toBe(200)
    expect((await res.json()).ticket.senderName).toBe(senderName)
  })

  test('400 for a 999-character messageId, and no ticket is stored', async ({ request }) => {
    const subject = `Too long messageId ${uniqueSuffix()}`
    const messageId = uniqueMessageId('too-long').padEnd(999, 'm')
    expect(messageId).toHaveLength(999)
    await expectTooLong(await postInbound(request, { ...validEmail(), messageId, subject }), 'messageId is too long')
    await expectNoTicketMatching(request, subject)
  })

  test('201 for a 998-character messageId, which then dedupes', async ({ request }) => {
    // messageId isn't in any response, so a redelivery returning the same ticket shows it was stored.
    const data = { ...validEmail(), messageId: uniqueMessageId('at-limit').padEnd(998, 'm') }
    expect(data.messageId).toHaveLength(998)
    const id = await expectCreated(await postInbound(request, data))

    const again = await postInbound(request, data)
    expect(again.status()).toBe(200)
    expect(await again.json()).toEqual({ ticket: { id } })
  })

  test('400 for a 50,001-character body, and no ticket is stored', async ({ request }) => {
    const subject = `Too long body ${uniqueSuffix()}`
    const body = 'b'.repeat(50_001)
    await expectTooLong(await postInbound(request, { ...validEmail(), body, subject }), 'body is too long')
    await expectNoTicketMatching(request, subject)
  })

  test('201 for a 50,000-character body, stored in full', async ({ request }) => {
    const body = 'b'.repeat(50_000)
    const id = await expectCreated(await postInbound(request, { ...validEmail(), body }))

    await signInViaApi(request, ADMIN)
    const res = await request.get(`/api/tickets/${id}`)
    expect(res.status()).toBe(200)
    expect((await res.json()).ticket.body).toBe(body)
  })

  test('400 for a 100,001-character bodyHTML, and no ticket is stored', async ({ request }) => {
    const subject = `Too long bodyHTML ${uniqueSuffix()}`
    const bodyHTML = `<p>${'h'.repeat(100_001 - 7)}</p>`
    expect(bodyHTML).toHaveLength(100_001)
    await expectTooLong(await postInbound(request, { ...validEmail(), bodyHTML, subject }), 'bodyHTML is too long')
    await expectNoTicketMatching(request, subject)
  })

  test('201 for a 100,000-character bodyHTML', async ({ request }) => {
    const bodyHTML = `<p>${'h'.repeat(100_000 - 7)}</p>`
    expect(bodyHTML).toHaveLength(100_000)
    await expectCreated(await postInbound(request, { ...validEmail(), bodyHTML }))
  })

  test('400 for a 999-character inReplyTo, and no ticket is stored', async ({ request }) => {
    const subject = `Too long inReplyTo ${uniqueSuffix()}`
    const inReplyTo = uniqueMessageId('too-long').padEnd(999, 'r')
    expect(inReplyTo).toHaveLength(999)
    await expectTooLong(await postInbound(request, { ...validEmail(), inReplyTo, subject }), 'inReplyTo is too long')
    await expectNoTicketMatching(request, subject)
  })

  test('201 for a 998-character inReplyTo (unknown, so a new ticket)', async ({ request }) => {
    const inReplyTo = uniqueMessageId('at-limit').padEnd(998, 'r')
    expect(inReplyTo).toHaveLength(998)
    await expectCreated(await postInbound(request, { ...validEmail(), inReplyTo }))
  })

  test('400 for a 999-character references entry, and no ticket is stored', async ({ request }) => {
    const subject = `Too long references entry ${uniqueSuffix()}`
    const entry = uniqueMessageId('too-long').padEnd(999, 'r')
    expect(entry).toHaveLength(999)
    const references = [uniqueMessageId('short'), entry]
    await expectTooLong(await postInbound(request, { ...validEmail(), references, subject }), 'references entry is too long')
    await expectNoTicketMatching(request, subject)
  })

  test('201 for a 998-character references entry (unknown, so a new ticket)', async ({ request }) => {
    const entry = uniqueMessageId('at-limit').padEnd(998, 'r')
    expect(entry).toHaveLength(998)
    await expectCreated(await postInbound(request, { ...validEmail(), references: [uniqueMessageId('short'), entry] }))
  })

  test('400 for 101 references entries, and no ticket is stored', async ({ request }) => {
    const subject = `Too many references ${uniqueSuffix()}`
    const references = Array.from({ length: 101 }, (_, i) => uniqueMessageId(`ref-${i}`))
    await expectTooLong(await postInbound(request, { ...validEmail(), references, subject }), 'references has too many entries')
    await expectNoTicketMatching(request, subject)
  })

  test('201 for 100 references entries (unknown, so a new ticket)', async ({ request }) => {
    const references = Array.from({ length: 100 }, (_, i) => uniqueMessageId(`ref-${i}`))
    await expectCreated(await postInbound(request, { ...validEmail(), references }))
  })

  test('201 for a request over 100 kB: the webhook has its own JSON limit', async ({ request }) => {
    const data = { ...validEmail(), body: 'b'.repeat(50_000), bodyHTML: `<p>${'h'.repeat(100_000 - 7)}</p>` }
    // The global parser's 100 kB default would answer this with 413.
    expect(JSON.stringify(data).length).toBeGreaterThan(100 * 1024)
    await expectCreated(await postInbound(request, data))
  })

  test('201 for a request over 1 MB with an attachment, and the file downloads whole', async ({ request }) => {
    const bytes = randomBytes(1.5 * MiB)
    const data = { ...validEmail(), attachments: [fileAttachment('photo.bin', 'application/octet-stream', bytes)] }
    expect(JSON.stringify(data).length).toBeGreaterThan(MiB)
    const id = await expectCreated(await postInbound(request, data))

    await signInViaApi(request, ADMIN)
    const [attachment] = await listAttachments(request, id)
    const res = await request.get(`/api/tickets/${id}/attachments/${attachment.id}`)
    expect(res.status()).toBe(200)
    expect((await res.body()).equals(bytes)).toBe(true)
  })

  test('a request over 35 MB gets a JSON 413, and no ticket is stored', async ({ request }) => {
    test.slow()
    const subject = `Over the JSON limit ${uniqueSuffix()}`
    // Valid base64, so only the parser's limit can answer 413; the schema would have said 400.
    const content = 'a'.repeat(36 * MiB)
    const data = { ...validEmail(), subject, attachments: [{ filename: 'huge.bin', contentType: 'application/zip', size: 1, content }] }
    expect(JSON.stringify(data).length).toBeGreaterThan(35 * MiB)

    const res = await postInbound(request, data)
    expect(res.status()).toBe(413)
    expect(await res.json()).toEqual({ error: expect.any(String) })
    await expectNoTicketMatching(request, subject)
  })
})

const ATTACHMENT_KEYS = ['contentId', 'contentType', 'filename', 'id', 'size', 'tooLarge']

// A small stored file, of known bytes.
const textFile = (filename = 'note.txt') => fileAttachment(filename, 'text/plain', Buffer.from('hello'))

// A stored file of exactly `bytes` bytes.
const fileOfSize = (bytes: number) => fileAttachment('file.bin', 'application/octet-stream', Buffer.alloc(bytes, 0x61))

// A file over the limits, which the mailer sends without content.
const listedOnlyFile = (size = 50_000_000) => ({ filename: 'video.mp4', contentType: 'video/mp4', size })

// The ticket's files, from GET /api/tickets/:id; `request` must be signed in.
async function listAttachments(request: APIRequestContext, ticketId: number): Promise<ListedAttachment[]> {
  return (await getTicket(request, ticketId)).attachments
}

// Posts one email with this file and returns it as stored. Signs `request` in as the admin.
async function storedAttachment(request: APIRequestContext, file: object): Promise<ListedAttachment> {
  const id = await expectCreated(await postInbound(request, { ...validEmail(), attachments: [file] }))
  await signInViaApi(request, ADMIN)
  const attachments = await listAttachments(request, id)
  expect(attachments).toHaveLength(1)
  return attachments[0]
}

// The webhook refuses these attachments with this error and stores no ticket.
async function expectRejected(request: APIRequestContext, attachments: unknown, error: string) {
  const subject = `Rejected attachments ${uniqueSuffix()}`
  const res = await postInbound(request, { ...validEmail(), subject, attachments })
  expect(res.status()).toBe(400)
  expect(await res.json()).toEqual({ error })
  await expectNoTicketMatching(request, subject)
}

test.describe('POST /api/webhooks/inbound-email: storing attachments', () => {
  test('files on a new ticket are listed in order with their fields, and without data', async ({ request }) => {
    const report = fileAttachment('report.pdf', 'application/pdf', Buffer.from('%PDF-1.7'))
    const logo = { ...fileAttachment('logo.png', 'image/png', Buffer.from('not really')), contentId: 'logo@example.com' }
    const id = await expectCreated(await postInbound(request, { ...validEmail(), attachments: [report, logo] }))

    await signInViaApi(request, ADMIN)
    const attachments = await listAttachments(request, id)
    expect(attachments).toEqual([
      { id: expect.any(Number), filename: 'report.pdf', contentType: 'application/pdf', size: 8, contentId: null, tooLarge: false },
      { id: expect.any(Number), filename: 'logo.png', contentType: 'image/png', size: 10, contentId: 'logo@example.com', tooLarge: false },
    ])
    for (const attachment of attachments) {
      expect(Object.keys(attachment).sort()).toEqual(ATTACHMENT_KEYS)
      expect(attachment).not.toHaveProperty('data')
    }
  })

  test('a ticket sent without attachments lists none', async ({ request }) => {
    const id = await expectCreated(await postInbound(request, validEmail()))

    await signInViaApi(request, ADMIN)
    expect(await listAttachments(request, id)).toEqual([])
  })

  test("a threaded reply's files are listed on the reply, without data, and not in the ticket's list", async ({ request }) => {
    const ticketFile = textFile('ticket.txt')
    const messageId = uniqueMessageId('attachment-root')
    const ticketId = await expectCreated(
      await postInbound(request, { ...validEmail(), messageId, attachments: [ticketFile] }),
    )
    const { data } = replyEmail({ inReplyTo: messageId })
    const replyId = await expectReplyCreated(
      await postInbound(request, { ...data, attachments: [textFile('reply.txt')] }),
      ticketId,
    )

    await signInViaApi(request, ADMIN)
    const onTicket = await listAttachments(request, ticketId)
    expect(onTicket.map((a) => a.filename)).toEqual(['ticket.txt'])

    const [reply] = await listReplies(request, ticketId)
    expect(reply.id).toBe(replyId)
    expect(reply.attachments).toEqual([
      { id: expect.any(Number), filename: 'reply.txt', contentType: 'text/plain', size: 5, contentId: null, tooLarge: false },
    ])
    expect(Object.keys(reply.attachments[0]).sort()).toEqual(ATTACHMENT_KEYS)
    expect(reply.attachments[0]).not.toHaveProperty('data')
  })

  test('a file without content is stored as tooLarge, listed with the size as reported', async ({ request }) => {
    const attachment = await storedAttachment(request, listedOnlyFile(52_428_800))
    expect(attachment).toEqual({
      id: expect.any(Number),
      filename: 'video.mp4',
      contentType: 'video/mp4',
      size: 52_428_800,
      contentId: null,
      tooLarge: true,
    })
  })

  test('a stored file has the size of its bytes, not the size reported', async ({ request }) => {
    const attachment = await storedAttachment(request, { ...textFile(), size: 999 })
    expect(attachment).toMatchObject({ size: 5, tooLarge: false })
  })

  test('a redelivered ticket does not duplicate its attachments', async ({ request }) => {
    const data = { ...validEmail(), messageId: uniqueMessageId('attachment-dedupe'), attachments: [textFile()] }
    const id = await expectCreated(await postInbound(request, data))
    await signInViaApi(request, ADMIN)
    const before = await listAttachments(request, id)
    expect(before).toHaveLength(1)

    const again = await postInbound(request, data)
    expect(again.status()).toBe(200)
    expect(await again.json()).toEqual({ ticket: { id } })

    expect(await listAttachments(request, id)).toEqual(before)
  })

  test('a redelivered reply does not duplicate its attachments', async ({ request }) => {
    const ticket = await createThreadTicket(request, 'attachment-reply-dedupe')
    const data = { ...replyEmail({ inReplyTo: ticket.messageId }).data, attachments: [textFile()] }
    const replyId = await expectReplyCreated(await postInbound(request, data), ticket.id)

    const again = await postInbound(request, data)
    expect(again.status()).toBe(200)
    expect(await again.json()).toEqual({ ticket: { id: ticket.id }, reply: { id: replyId } })

    await signInViaApi(request, ADMIN)
    const replies = await listReplies(request, ticket.id)
    expect(replies).toHaveLength(1)
    expect(replies[0].attachments).toHaveLength(1)
    expect(await listAttachments(request, ticket.id)).toEqual([])
  })
})

test.describe('POST /api/webhooks/inbound-email: emails without text', () => {
  test('an attachment-only email creates a ticket with the body (no text)', async ({ request }) => {
    const id = await expectCreated(await postInbound(request, { ...validEmail(), body: '', attachments: [textFile()] }))

    await signInViaApi(request, ADMIN)
    const ticket = await getTicket(request, id)
    expect(ticket.body).toBe('(no text)')
    expect(ticket.attachments).toHaveLength(1)
  })

  test('a listed-only file is enough for a blank body too', async ({ request }) => {
    const id = await expectCreated(
      await postInbound(request, { ...validEmail(), body: '', attachments: [listedOnlyFile()] }),
    )

    await signInViaApi(request, ADMIN)
    expect((await getTicket(request, id)).body).toBe('(no text)')
  })

  test('an HTML-only email creates a ticket with the body (no text) and keeps the HTML', async ({ request }) => {
    const bodyHTML = '<p><img src="cid:shot"></p>'
    const id = await expectCreated(await postInbound(request, { ...validEmail(), body: '   ', bodyHTML }))

    await signInViaApi(request, ADMIN)
    expect(await getTicket(request, id)).toMatchObject({ body: '(no text)', bodyHTML })
  })

  test('an attachment-only reply is stored with the body (no text)', async ({ request }) => {
    const ticket = await createThreadTicket(request, 'attachment-only-reply')
    const { bodyHTML: _bodyHTML, ...data } = replyEmail({ inReplyTo: ticket.messageId }).data
    await expectReplyCreated(await postInbound(request, { ...data, body: '', attachments: [textFile()] }), ticket.id)

    await signInViaApi(request, ADMIN)
    const [reply] = await listReplies(request, ticket.id)
    expect(reply.body).toBe('(no text)')
    expect(reply.attachments).toHaveLength(1)
  })

  const blankBodies: [string, object][] = [
    ['an empty body', { body: '' }],
    ['a whitespace body', { body: '   ' }],
    ['an empty body and an empty attachments list', { body: '', attachments: [] }],
  ]

  for (const [label, fields] of blankBodies) {
    test(`400 for ${label} with no HTML, and no ticket is stored`, async ({ request }) => {
      const subject = `Blank body ${uniqueSuffix()}`
      const res = await postInbound(request, { ...validEmail(), subject, ...fields })
      expect(res.status()).toBe(400)
      expect(await res.json()).toEqual({ error: 'body is required' })
      await expectNoTicketMatching(request, subject)
    })
  }

  test('400 for a missing body key, even with attachments: the key has to be there, if blank', async ({ request }) => {
    const { body: _body, ...data } = validEmail()
    const res = await postInbound(request, { ...data, attachments: [textFile()] })
    expect(res.status()).toBe(400)
    expect(await res.json()).toEqual({ error: 'body is required' })
  })
})

test.describe('POST /api/webhooks/inbound-email: cleaning attachment fields', () => {
  const filenames: [string, string, string][] = [
    ['a filename containing NUL is stored cleaned: 201, not 500', 'inv\u0000oice.pdf', 'invoice.pdf'],
    ['line breaks and other control characters are stripped from a filename', ' in\r\nvoice\u0007\u007f.pdf ', 'invoice.pdf'],
    ['a filename of only control characters becomes "attachment"', '\u0000\r\n', 'attachment'],
    ['a filename over 255 characters is cut to 255', 'f'.repeat(300), 'f'.repeat(255)],
  ]

  for (const [label, filename, stored] of filenames) {
    test(label, async ({ request }) => {
      expect(await storedAttachment(request, { ...textFile(), filename })).toMatchObject({ filename: stored })
    })
  }

  const contentTypes: [string, string | undefined, string][] = [
    ['an invalid contentType becomes application/octet-stream', 'not a type', 'application/octet-stream'],
    ['a contentType containing NUL becomes application/octet-stream', 'text/pl\u0000ain', 'application/octet-stream'],
    ['a missing contentType becomes application/octet-stream', undefined, 'application/octet-stream'],
    ['a contentType is stored lower-cased', 'IMAGE/PNG', 'image/png'],
  ]

  for (const [label, contentType, stored] of contentTypes) {
    test(label, async ({ request }) => {
      expect(await storedAttachment(request, { ...textFile(), contentType })).toMatchObject({ contentType: stored })
    })
  }

  const contentIds: [string, unknown, string | null][] = [
    ['an invalid contentId is dropped', 'has a space', null],
    ['a contentId containing NUL is dropped', 'lo\u0000go', null],
    ['a contentId that is not a string is dropped', 5, null],
    ['a valid contentId is stored trimmed', ' <logo@example.com> ', '<logo@example.com>'],
  ]

  for (const [label, contentId, stored] of contentIds) {
    test(label, async ({ request }) => {
      expect(await storedAttachment(request, { ...textFile(), contentId })).toMatchObject({ contentId: stored })
    })
  }
})

test.describe('POST /api/webhooks/inbound-email: attachment limits', () => {
  test('400 for 21 stored files, and no ticket is stored', async ({ request }) => {
    await expectRejected(request, Array.from({ length: 21 }, () => textFile()), 'attachments has too many files')
  })

  test('201 for 20 stored files', async ({ request }) => {
    const id = await expectCreated(
      await postInbound(request, { ...validEmail(), attachments: Array.from({ length: 20 }, () => textFile()) }),
    )

    await signInViaApi(request, ADMIN)
    expect(await listAttachments(request, id)).toHaveLength(20)
  })

  test('201 for 20 stored files and 5 listed ones: the limit counts only stored files', async ({ request }) => {
    const attachments = [
      ...Array.from({ length: 20 }, () => textFile()),
      ...Array.from({ length: 5 }, () => listedOnlyFile()),
    ]
    const id = await expectCreated(await postInbound(request, { ...validEmail(), attachments }))

    await signInViaApi(request, ADMIN)
    const listed = await listAttachments(request, id)
    expect(listed.filter((a) => a.tooLarge)).toHaveLength(5)
    expect(listed.filter((a) => !a.tooLarge)).toHaveLength(20)
  })

  test('400 for 101 entries, and no ticket is stored', async ({ request }) => {
    await expectRejected(request, Array.from({ length: 101 }, () => listedOnlyFile()), 'attachments has too many entries')
  })

  test('201 for 100 listed entries', async ({ request }) => {
    const attachments = Array.from({ length: 100 }, () => listedOnlyFile())
    const id = await expectCreated(await postInbound(request, { ...validEmail(), attachments }))

    await signInViaApi(request, ADMIN)
    expect(await listAttachments(request, id)).toHaveLength(100)
  })

  test('400 for a file one byte over 10 MiB, and no ticket is stored', async ({ request }) => {
    test.slow()
    await expectRejected(request, [fileOfSize(10 * MiB + 1)], 'attachment is too large')
  })

  test('201 for a file of exactly 10 MiB', async ({ request }) => {
    test.slow()
    const attachment = await storedAttachment(request, fileOfSize(10 * MiB))
    expect(attachment).toMatchObject({ size: 10 * MiB, tooLarge: false })
  })

  test('400 for files one byte over 25 MiB in total, each under the file limit, and no ticket is stored', async ({ request }) => {
    test.slow()
    const attachments = [fileOfSize(10 * MiB), fileOfSize(10 * MiB), fileOfSize(5 * MiB + 1)]
    // Under the JSON limit, or this would be the parser's 413 and not the schema's 400.
    expect(JSON.stringify(attachments).length).toBeLessThan(35 * MiB)
    await expectRejected(request, attachments, 'attachments are too large')
  })

  test('201 for files of exactly 25 MiB in total: the JSON limit leaves room for them as base64', async ({ request }) => {
    test.slow()
    const attachments = [fileOfSize(10 * MiB), fileOfSize(10 * MiB), fileOfSize(5 * MiB)]
    const id = await expectCreated(await postInbound(request, { ...validEmail(), attachments }))

    await signInViaApi(request, ADMIN)
    const listed = await listAttachments(request, id)
    expect(listed.map((a) => a.size)).toEqual([10 * MiB, 10 * MiB, 5 * MiB])
  })

  const invalid: [string, unknown, string][] = [
    ['invalid base64', [{ ...textFile(), content: 'not base64!' }], 'attachment content must be base64'],
    ['attachments not an array', 'note.txt', 'attachments must be an array'],
    ['a missing filename', [{ contentType: 'text/plain', size: 1 }], 'attachment filename is required'],
    ['a missing size', [{ filename: 'note.txt', contentType: 'text/plain' }], 'attachment size must be an integer'],
    ['a fractional size', [{ ...listedOnlyFile(), size: 1.5 }], 'attachment size must be an integer'],
  ]

  for (const [label, attachments, error] of invalid) {
    test(`400 for ${label}, and no ticket is stored`, async ({ request }) => {
      await expectRejected(request, attachments, error)
    })
  }
})
