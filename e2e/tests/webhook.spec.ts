import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { ADMIN, signInViaApi } from '../fixtures/auth.js'
import { uniqueSuffix } from '../fixtures/users.js'
import { inboundSecret } from '../fixtures/webhook.js'
import { updateTicketViaApi } from '../fixtures/tickets.js'

// The route answers with `{ ticket: { id } }` (plus `reply: { id }` for a threaded email), so most
// tests check the wire response. The stored list fields are checked through GET /api/tickets in
// tickets.spec.ts; the threading tests read the stored replies and status back through the API.

const ENDPOINT = '/api/webhooks/inbound-email'

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

async function ticketStatus(request: APIRequestContext, ticketId: number): Promise<string> {
  const res = await request.get(`/api/tickets/${ticketId}`)
  expect(res.status()).toBe(200)
  return (await res.json()).ticket.status
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

  test('201 for a request over 100 kB: the webhook has its own 1 MB JSON limit', async ({ request }) => {
    const data = { ...validEmail(), body: 'b'.repeat(50_000), bodyHTML: `<p>${'h'.repeat(100_000 - 7)}</p>` }
    // The global parser's 100 kB default would answer this with 413.
    expect(JSON.stringify(data).length).toBeGreaterThan(100 * 1024)
    await expectCreated(await postInbound(request, data))
  })

  test('a request over 1 MB gets a JSON 413', async ({ request }) => {
    const data = { ...validEmail(), body: 'x'.repeat(1100 * 1024) }
    expect(JSON.stringify(data).length).toBeGreaterThan(1024 * 1024)
    const res = await postInbound(request, data)
    expect(res.status()).toBe(413)
    expect(await res.json()).toEqual({ error: expect.any(String) })
  })
})
