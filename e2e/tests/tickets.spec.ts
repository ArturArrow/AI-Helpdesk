import { expect, test, type APIRequestContext } from '@playwright/test'
import { ADMIN, AGENT, signInViaApi } from '../fixtures/auth.js'
import { createTicketViaWebhook } from '../fixtures/tickets.js'
import { uniqueSuffix } from '../fixtures/users.js'
import { inboundSecret } from '../fixtures/webhook.js'

// Other specs create tickets in the same database, so these tests find their own rows by unique
// subject and compare relative order, never absolute positions or counts.

type ListedTicket = { id: number; subject: string }

test.describe('GET /api/tickets', () => {
  test('401 without a session', async ({ request }) => {
    const res = await request.get('/api/tickets')
    expect(res.status()).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  for (const user of [AGENT, ADMIN]) {
    test(`200 for the ${user.name.toLowerCase()} with the created ticket listed`, async ({ request }) => {
      const ticket = await createTicketViaWebhook(request)
      await signInViaApi(request, user)

      const res = await request.get('/api/tickets')
      expect(res.status()).toBe(200)
      const { tickets } = await res.json()
      expect(tickets).toContainEqual(expect.objectContaining({ id: ticket.id, subject: ticket.subject }))
    })
  }

  test('each ticket has exactly the list fields and no body, bodyHTML or messageId', async ({ request }) => {
    const suffix = uniqueSuffix()
    const res = await request.post('/api/webhooks/inbound-email', {
      headers: { 'X-Inbound-Secret': inboundSecret() },
      data: {
        subject: `E2E fields ${suffix}`,
        senderName: `Customer ${suffix}`,
        senderEmail: `Customer-${suffix}@Example.com`,
        body: 'Plain body',
        bodyHTML: '<p>HTML body</p>',
        messageId: `<fields-${suffix}@example.com>`,
      },
    })
    expect(res.status()).toBe(201)
    const { ticket: created } = await res.json()

    await signInViaApi(request, AGENT)
    const { tickets } = await (await request.get('/api/tickets')).json()
    const ticket = tickets.find((t: ListedTicket) => t.id === created.id)

    expect(ticket).toEqual({
      id: created.id,
      subject: `E2E fields ${suffix}`,
      senderName: `Customer ${suffix}`,
      senderEmail: `customer-${suffix}@example.com`,
      status: 'open',
      category: null,
      createdAt: expect.any(String),
    })
    expect(Number.isNaN(Date.parse(ticket.createdAt))).toBe(false)
    for (const t of tickets) {
      expect(Object.keys(t).sort()).toEqual(
        ['category', 'createdAt', 'id', 'senderEmail', 'senderName', 'status', 'subject'],
      )
    }
  })

  test('tickets are ordered newest first', async ({ request }) => {
    const first = await createTicketViaWebhook(request, 'first')
    const second = await createTicketViaWebhook(request, 'second')
    const third = await createTicketViaWebhook(request, 'third')
    await signInViaApi(request, AGENT)

    const { tickets } = await (await request.get('/api/tickets')).json()
    const ids: number[] = tickets.map((t: ListedTicket) => t.id)
    const positions = [third.id, second.id, first.id].map((id) => ids.indexOf(id))

    expect(positions).not.toContain(-1)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))

    // The whole list is newest first too, not just our three.
    const times: number[] = tickets.map((t: { createdAt: string }) => Date.parse(t.createdAt))
    expect(times).toEqual([...times].sort((a, b) => b - a))
  })
})


type SortedTicket = ListedTicket & { status: string; category: string | null; createdAt: string }

// GETs /api/tickets with the given sort params and asserts 200.
async function listTickets(request: APIRequestContext, params: Record<string, string>): Promise<SortedTicket[]> {
  const res = await request.get('/api/tickets', { params })
  expect(res.status(), `GET /api/tickets ${new URLSearchParams(params)}`).toBe(200)
  return (await res.json()).tickets
}

// Asserts every id is listed and they appear in the given order (others may sit in between).
function expectInOrder(tickets: SortedTicket[], ids: number[]) {
  const listed = tickets.map((t) => t.id)
  const positions = ids.map((id) => listed.indexOf(id))
  expect(positions).not.toContain(-1)
  expect(positions).toEqual([...positions].sort((a, b) => a - b))
}

test.describe('GET /api/tickets sorting', () => {
  test('401 without a session, with valid or invalid sort params', async ({ request }) => {
    for (const params of [{ sortBy: 'subject', sortOrder: 'asc' }, { sortBy: 'nope', sortOrder: 'nope' }]) {
      const res = await request.get('/api/tickets', { params })
      expect(res.status()).toBe(401)
      expect(await res.json()).toEqual({ error: 'Unauthorized' })
    }
  })

  test('an invalid sortBy gets 400 with the allowed fields', async ({ request }) => {
    await signInViaApi(request, AGENT)
    // senderEmail is a listed column, but not a sortable one.
    const res = await request.get('/api/tickets', { params: { sortBy: 'senderEmail' } })
    expect(res.status()).toBe(400)
    expect(await res.json()).toEqual({
      error: 'sortBy must be one of: subject, senderName, status, category, createdAt',
    })
  })

  test('an invalid sortOrder gets 400', async ({ request }) => {
    await signInViaApi(request, AGENT)
    const res = await request.get('/api/tickets', { params: { sortBy: 'subject', sortOrder: 'sideways' } })
    expect(res.status()).toBe(400)
    expect(await res.json()).toEqual({ error: 'sortOrder must be asc or desc' })
  })

  for (const sortOrder of ['asc', 'desc']) {
    test(`sortBy=subject&sortOrder=${sortOrder} orders subjects ${sortOrder === 'asc' ? 'A to Z' : 'Z to A'}`, async ({ request }) => {
      // Created out of alphabetical order, so creation order can't produce the expected result.
      const prefix = `E2E sort subject ${uniqueSuffix()}`
      const b = await createTicketViaWebhook(request, 'b', { subject: `${prefix} B` })
      const c = await createTicketViaWebhook(request, 'c', { subject: `${prefix} C` })
      const a = await createTicketViaWebhook(request, 'a', { subject: `${prefix} A` })
      await signInViaApi(request, AGENT)

      const tickets = await listTickets(request, { sortBy: 'subject', sortOrder })
      expectInOrder(tickets, sortOrder === 'asc' ? [a.id, b.id, c.id] : [c.id, b.id, a.id])
    })
  }

  test('sortBy=senderName orders sender names, descending by default and ascending with asc', async ({ request }) => {
    const prefix = `E2E sender ${uniqueSuffix()}`
    const b = await createTicketViaWebhook(request, 'b', { senderName: `${prefix} B` })
    const a = await createTicketViaWebhook(request, 'a', { senderName: `${prefix} A` })
    const c = await createTicketViaWebhook(request, 'c', { senderName: `${prefix} C` })
    await signInViaApi(request, ADMIN)

    expectInOrder(await listTickets(request, { sortBy: 'senderName' }), [c.id, b.id, a.id])
    expectInOrder(await listTickets(request, { sortBy: 'senderName', sortOrder: 'asc' }), [a.id, b.id, c.id])
  })

  test('equal subjects fall back to newest first in both directions', async ({ request }) => {
    const subject = `E2E same subject ${uniqueSuffix()}`
    const older = await createTicketViaWebhook(request, 'older', { subject })
    const newer = await createTicketViaWebhook(request, 'newer', { subject })
    await signInViaApi(request, AGENT)

    for (const sortOrder of ['asc', 'desc']) {
      expectInOrder(await listTickets(request, { sortBy: 'subject', sortOrder }), [newer.id, older.id])
    }
  })

  test('sortBy=createdAt&sortOrder=asc lists oldest first', async ({ request }) => {
    const first = await createTicketViaWebhook(request, 'first')
    const second = await createTicketViaWebhook(request, 'second')
    const third = await createTicketViaWebhook(request, 'third')
    await signInViaApi(request, AGENT)

    const tickets = await listTickets(request, { sortBy: 'createdAt', sortOrder: 'asc' })
    expectInOrder(tickets, [first.id, second.id, third.id])

    const times = tickets.map((t) => Date.parse(t.createdAt))
    expect(times).toEqual([...times].sort((x, y) => x - y))
  })

  // The webhook creates only unclassified tickets and nothing sets a category yet, so this can only
  // check that null categories don't break the sort and that the newest-first tie-break holds.
  test('sortBy=category succeeds with unclassified tickets, newest first among equals', async ({ request }) => {
    const first = await createTicketViaWebhook(request, 'first')
    const second = await createTicketViaWebhook(request, 'second')
    const third = await createTicketViaWebhook(request, 'third')
    await signInViaApi(request, AGENT)

    for (const sortOrder of ['asc', 'desc']) {
      const tickets = await listTickets(request, { sortBy: 'category', sortOrder })
      expectInOrder(tickets, [third.id, second.id, first.id])
      const ours = tickets.filter((t) => [first.id, second.id, third.id].includes(t.id))
      expect(ours.map((t) => t.category)).toEqual([null, null, null])
    }
  })

  // The webhook creates only open tickets, so the status order itself can't vary yet.
  test('sortBy=status succeeds in both directions', async ({ request }) => {
    await createTicketViaWebhook(request)
    await signInViaApi(request, AGENT)

    for (const sortOrder of ['asc', 'desc']) {
      await listTickets(request, { sortBy: 'status', sortOrder })
    }
  })
})
