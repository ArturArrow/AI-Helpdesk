import { expect, test, type APIRequestContext } from '@playwright/test'
import { ADMIN, AGENT, signInViaApi } from '../fixtures/auth.js'
import {
  addAiReplyInDb,
  createTicketViaWebhook,
  deleteAllTicketsInDb,
  setTicketInDb,
  setTicketStatusInDb,
  updateTicketViaApi,
} from '../fixtures/tickets.js'
import { uniqueSuffix } from '../fixtures/users.js'
import { inboundSecret } from '../fixtures/webhook.js'

// GET /api/tickets/stats returns { total, open, resolvedByAi, averageResolutionMs } over every
// ticket in the database, so the tests that check the numbers start from an empty ticket table
// (deleteAllTicketsInDb) and create exactly the tickets they count. Other specs find their own
// tickets by unique values, so emptying the table can't break them.
//
// resolvedAt isn't in any response; averageResolutionMs is how the tests observe it. They set
// createdAt (and, where noted, resolvedAt) directly in the DB to get known durations.

const HOUR = 60 * 60 * 1000

type TicketStats = { total: number; open: number; resolvedByAi: number; averageResolutionMs: number | null }

const DAY = 24 * HOUR

const PERIOD_ERROR = 'period must be one of: 7d, 30d, 90d, all'

// `request` must be signed in (as anyone). Without a period, no query string is sent.
async function getStats(request: APIRequestContext, period?: string): Promise<TicketStats> {
  const res = await request.get('/api/tickets/stats', period === undefined ? {} : { params: { period } })
  expect(res.status(), `stats for period ${period ?? '(none)'}`).toBe(200)
  return res.json()
}

const averageOf = async (request: APIRequestContext) => (await getStats(request)).averageResolutionMs

test.describe('GET /api/tickets/stats: auth', () => {
  test('401 without a session', async ({ request }) => {
    const res = await request.get('/api/tickets/stats')
    expect(res.status()).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  for (const user of [AGENT, ADMIN]) {
    test(`200 for the ${user.name.toLowerCase()} with exactly total, open, resolvedByAi and averageResolutionMs`, async ({ request }) => {
      await signInViaApi(request, user)
      const res = await request.get('/api/tickets/stats')
      expect(res.status()).toBe(200)
      const stats = await res.json()
      expect(Object.keys(stats).sort()).toEqual(['averageResolutionMs', 'open', 'resolvedByAi', 'total'])
      expect(stats).toMatchObject({
        total: expect.any(Number),
        open: expect.any(Number),
        resolvedByAi: expect.any(Number),
      })
      if (stats.averageResolutionMs !== null) expect(typeof stats.averageResolutionMs).toBe('number')
    })
  }
})

test.describe('GET /api/tickets/stats: counts', () => {
  test.beforeEach(() => deleteAllTicketsInDb())

  test('all zero and a null average with no tickets', async ({ request }) => {
    await signInViaApi(request, AGENT)
    expect(await getStats(request)).toEqual({ total: 0, open: 0, resolvedByAi: 0, averageResolutionMs: null })
  })

  test('total counts every status including new and processing; open counts only open; resolvedByAi counts finished tickets with an ai reply, once each', async ({ request }) => {
    await createTicketViaWebhook(request, 'stats-open')
    const openWithAi = await createTicketViaWebhook(request, 'stats-open-ai')
    const resolvedWithAi = await createTicketViaWebhook(request, 'stats-resolved-ai')
    const closedWithAi = await createTicketViaWebhook(request, 'stats-closed-ai')
    const resolved = await createTicketViaWebhook(request, 'stats-resolved')
    const closed = await createTicketViaWebhook(request, 'stats-closed')
    const created = await createTicketViaWebhook(request, 'stats-new')
    const processing = await createTicketViaWebhook(request, 'stats-processing')

    // An ai reply on an open ticket (reopened after the AI answered) doesn't count.
    addAiReplyInDb(openWithAi.id, 'Answered by the AI, then reopened.')
    setTicketStatusInDb(resolvedWithAi.id, 'resolved')
    addAiReplyInDb(resolvedWithAi.id, 'First AI answer.')
    // A second ai reply on the same ticket still counts it once.
    addAiReplyInDb(resolvedWithAi.id, 'Second AI answer.')
    setTicketStatusInDb(closedWithAi.id, 'closed')
    addAiReplyInDb(closedWithAi.id, 'AI answer, later closed.')
    setTicketStatusInDb(resolved.id, 'resolved')
    setTicketStatusInDb(closed.id, 'closed')
    setTicketStatusInDb(created.id, 'new')
    setTicketStatusInDb(processing.id, 'processing')

    await signInViaApi(request, AGENT)
    const stats = await getStats(request)
    expect(stats).toMatchObject({ total: 8, open: 2, resolvedByAi: 2 })
  })

  test('a new ticket from the webhook counts in total and open at once', async ({ request }) => {
    await createTicketViaWebhook(request, 'stats-webhook')
    await signInViaApi(request, AGENT)
    expect(await getStats(request)).toEqual({ total: 1, open: 1, resolvedByAi: 0, averageResolutionMs: null })
  })
})

// ?period=7d|30d|90d limits total, resolvedByAi and averageResolutionMs to tickets created in the
// last 7, 30 or 90 days; open always counts every open ticket. Tickets sit days away from every
// period boundary, so the time between setting createdAt and the request can't move them across.
test.describe('GET /api/tickets/stats: period', () => {
  for (const period of ['week', '7', '7D', '1d', '365d', 'ALL', '']) {
    test(`period=${JSON.stringify(period)} gets 400 with the allowed periods`, async ({ request }) => {
      await signInViaApi(request, AGENT)
      const res = await request.get('/api/tickets/stats', { params: { period } })
      expect(res.status()).toBe(400)
      expect(await res.json()).toEqual({ error: PERIOD_ERROR })
    })
  }

  test('a repeated period param gets 400 instead of using either value', async ({ request }) => {
    await signInViaApi(request, AGENT)
    const res = await request.get('/api/tickets/stats?period=7d&period=30d')
    expect(res.status()).toBe(400)
    expect(await res.json()).toEqual({ error: PERIOD_ERROR })
  })

  test('401 without a session, even with an invalid period', async ({ request }) => {
    const res = await request.get('/api/tickets/stats', { params: { period: 'week' } })
    expect(res.status()).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  test.describe('counts', () => {
    test.beforeEach(() => deleteAllTicketsInDb())

    test('each period counts total, resolvedByAi and the exact average over tickets created inside it; open counts every open ticket; no period equals all', async ({ request }) => {
      const now = Date.now()
      // Durations of 1, 3, 5 and 7 hours, so every period's average is a whole number of hours.
      const finished = async (label: string, daysAgo: number, hours: number, status: string, aiReply: boolean) => {
        const ticket = await createTicketViaWebhook(request, label)
        const createdAt = new Date(now - daysAgo * DAY)
        setTicketInDb(ticket.id, { status, createdAt, resolvedAt: new Date(createdAt.getTime() + hours * HOUR) })
        if (aiReply) addAiReplyInDb(ticket.id, `AI answer for ${label}.`)
      }
      await createTicketViaWebhook(request, 'period-open-now')
      await finished('period-3d-ai', 3, 1, 'resolved', true)
      await finished('period-20d', 20, 3, 'closed', false)
      const oldOpen = await createTicketViaWebhook(request, 'period-60d-open')
      setTicketInDb(oldOpen.id, { createdAt: new Date(now - 60 * DAY) })
      await finished('period-60d-ai', 60, 5, 'resolved', true)
      await finished('period-200d-ai', 200, 7, 'closed', true)

      await signInViaApi(request, AGENT)
      expect(await getStats(request, '7d')).toEqual({ total: 2, open: 2, resolvedByAi: 1, averageResolutionMs: 1 * HOUR })
      expect(await getStats(request, '30d')).toEqual({ total: 3, open: 2, resolvedByAi: 1, averageResolutionMs: 2 * HOUR })
      expect(await getStats(request, '90d')).toEqual({ total: 5, open: 2, resolvedByAi: 2, averageResolutionMs: 3 * HOUR })
      const all = await getStats(request, 'all')
      expect(all).toEqual({ total: 6, open: 2, resolvedByAi: 3, averageResolutionMs: 4 * HOUR })
      expect(await getStats(request)).toEqual(all)
    })

    test('an open ticket created long ago counts in open for every period, including 7d', async ({ request }) => {
      const ticket = await createTicketViaWebhook(request, 'period-old-open')
      setTicketInDb(ticket.id, { createdAt: new Date(Date.now() - 60 * DAY) })

      await signInViaApi(request, ADMIN)
      for (const period of ['7d', '30d']) {
        expect(await getStats(request, period)).toEqual({ total: 0, open: 1, resolvedByAi: 0, averageResolutionMs: null })
      }
      for (const period of ['90d', 'all']) {
        expect(await getStats(request, period)).toEqual({ total: 1, open: 1, resolvedByAi: 0, averageResolutionMs: null })
      }
    })

    test('a period goes by createdAt, not resolvedAt: a ticket created 10 days ago and resolved yesterday is outside 7d and inside 30d', async ({ request }) => {
      const now = Date.now()
      const ticket = await createTicketViaWebhook(request, 'period-late-resolve')
      setTicketInDb(ticket.id, { status: 'resolved', createdAt: new Date(now - 10 * DAY), resolvedAt: new Date(now - DAY) })
      addAiReplyInDb(ticket.id, 'Resolved by the AI yesterday.')

      await signInViaApi(request, AGENT)
      expect(await getStats(request, '7d')).toEqual({ total: 0, open: 0, resolvedByAi: 0, averageResolutionMs: null })
      expect(await getStats(request, '30d')).toEqual({ total: 1, open: 0, resolvedByAi: 1, averageResolutionMs: 9 * DAY })
    })
  })
})

test.describe('GET /api/tickets/stats: averageResolutionMs', () => {
  test.beforeEach(() => deleteAllTicketsInDb())

  test('null when no finished ticket has a resolvedAt: open, new and processing tickets, a resolved one without resolvedAt, and an open one with a stale resolvedAt are ignored', async ({ request }) => {
    const now = Date.now()
    await createTicketViaWebhook(request, 'avg-open')
    const created = await createTicketViaWebhook(request, 'avg-new')
    const processing = await createTicketViaWebhook(request, 'avg-processing')
    const resolvedNoTime = await createTicketViaWebhook(request, 'avg-resolved-no-time')
    const openWithTime = await createTicketViaWebhook(request, 'avg-open-with-time')
    setTicketStatusInDb(created.id, 'new')
    setTicketStatusInDb(processing.id, 'processing')
    setTicketInDb(resolvedNoTime.id, { status: 'resolved', resolvedAt: null })
    setTicketInDb(openWithTime.id, { createdAt: new Date(now - 2 * HOUR), resolvedAt: new Date(now - HOUR) })

    await signInViaApi(request, AGENT)
    expect(await getStats(request)).toEqual({ total: 5, open: 2, resolvedByAi: 0, averageResolutionMs: null })
  })

  test('the mean of resolvedAt - createdAt over resolved and closed tickets, in ms', async ({ request }) => {
    const now = Date.now()
    const resolved = await createTicketViaWebhook(request, 'avg-resolved')
    const closed = await createTicketViaWebhook(request, 'avg-closed')
    const ignored = await createTicketViaWebhook(request, 'avg-ignored-open')
    // 1 hour and 3 hours: the mean is 2 hours.
    setTicketInDb(resolved.id, { status: 'resolved', createdAt: new Date(now - 3 * HOUR), resolvedAt: new Date(now - 2 * HOUR) })
    setTicketInDb(closed.id, { status: 'closed', createdAt: new Date(now - 5 * HOUR), resolvedAt: new Date(now - 2 * HOUR) })
    setTicketInDb(ignored.id, { createdAt: new Date(now - 100 * HOUR) })

    await signInViaApi(request, ADMIN)
    expect(await averageOf(request)).toBe(2 * HOUR)
  })
})

// PATCH /api/tickets/:id stamps resolvedAt when a ticket becomes resolved or closed, keeps it when
// it moves between those two (or the status isn't changed), and clears it when it's reopened.
test.describe('PATCH /api/tickets/:id: resolvedAt, seen through the stats average', () => {
  test.beforeEach(() => deleteAllTicketsInDb())

  // The average is the server's now minus the ticket's createdAt; the bounds allow 1 s of slack.
  async function expectStampedBetween(request: APIRequestContext, createdAt: Date, before: number, after: number) {
    const average = await averageOf(request)
    expect(average).not.toBeNull()
    expect(average!).toBeGreaterThanOrEqual(before - createdAt.getTime() - 1000)
    expect(average!).toBeLessThanOrEqual(after - createdAt.getTime() + 1000)
  }

  for (const status of ['resolved', 'closed']) {
    test(`open -> ${status} stamps resolvedAt with the time of the PATCH`, async ({ request }) => {
      const ticket = await createTicketViaWebhook(request, `patch-${status}`)
      const createdAt = new Date(Date.now() - HOUR)
      setTicketInDb(ticket.id, { createdAt })
      await signInViaApi(request, AGENT)
      expect(await averageOf(request)).toBeNull()

      const before = Date.now()
      await updateTicketViaApi(request, ticket.id, { status })
      const after = Date.now()

      await expectStampedBetween(request, createdAt, before, after)
    })
  }

  test('resolved -> closed -> resolved keeps the original resolvedAt', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'patch-keep')
    const createdAt = new Date(Date.now() - 2 * HOUR)
    setTicketInDb(ticket.id, { createdAt })
    await signInViaApi(request, AGENT)
    await updateTicketViaApi(request, ticket.id, { status: 'resolved' })
    // Move the stamp to a known time, so any re-stamp would show as ~2 hours.
    setTicketInDb(ticket.id, { resolvedAt: new Date(createdAt.getTime() + 60_000) })
    expect(await averageOf(request)).toBe(60_000)

    await updateTicketViaApi(request, ticket.id, { status: 'closed' })
    expect(await averageOf(request)).toBe(60_000)

    await updateTicketViaApi(request, ticket.id, { status: 'resolved' })
    expect(await averageOf(request)).toBe(60_000)
  })

  test('a PATCH without a status change keeps resolvedAt: same status again, or only the category or assignee', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'patch-no-status')
    const createdAt = new Date(Date.now() - 2 * HOUR)
    setTicketInDb(ticket.id, { createdAt })
    await signInViaApi(request, ADMIN)
    await updateTicketViaApi(request, ticket.id, { status: 'resolved' })
    setTicketInDb(ticket.id, { resolvedAt: new Date(createdAt.getTime() + 60_000) })

    await updateTicketViaApi(request, ticket.id, { status: 'resolved' })
    expect(await averageOf(request)).toBe(60_000)
    await updateTicketViaApi(request, ticket.id, { category: 'refund_request' })
    expect(await averageOf(request)).toBe(60_000)
    await updateTicketViaApi(request, ticket.id, { assignedToId: null })
    expect(await averageOf(request)).toBe(60_000)
  })

  test('resolved -> open clears resolvedAt; resolving again stamps a new time', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'patch-reopen')
    const createdAt = new Date(Date.now() - 2 * HOUR)
    setTicketInDb(ticket.id, { createdAt })
    await signInViaApi(request, AGENT)
    await updateTicketViaApi(request, ticket.id, { status: 'resolved' })
    setTicketInDb(ticket.id, { resolvedAt: new Date(createdAt.getTime() + 60_000) })
    expect(await averageOf(request)).toBe(60_000)

    await updateTicketViaApi(request, ticket.id, { status: 'open' })
    expect(await getStats(request)).toMatchObject({ open: 1, averageResolutionMs: null })

    const before = Date.now()
    await updateTicketViaApi(request, ticket.id, { status: 'resolved' })
    const after = Date.now()
    await expectStampedBetween(request, createdAt, before, after)
  })

  test('closed -> open clears resolvedAt', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'patch-reopen-closed')
    await signInViaApi(request, AGENT)
    await updateTicketViaApi(request, ticket.id, { status: 'closed' })
    expect(await averageOf(request)).not.toBeNull()

    await updateTicketViaApi(request, ticket.id, { status: 'open' })
    expect(await averageOf(request)).toBeNull()
  })
})

test.describe('webhook threading: resolvedAt, seen through the stats', () => {
  test.beforeEach(() => deleteAllTicketsInDb())

  test('a customer reply that reopens an AI-resolved ticket removes it from the average and from resolvedByAi', async ({ request }) => {
    const messageId = `<stats-thread-${uniqueSuffix()}@example.com>`
    const ticket = await createTicketViaWebhook(request, 'stats-thread', { messageId })
    setTicketInDb(ticket.id, { status: 'resolved', createdAt: new Date(Date.now() - 2 * HOUR), resolvedAt: new Date(Date.now() - HOUR) })
    addAiReplyInDb(ticket.id, 'Answered from the knowledge base.')
    await signInViaApi(request, AGENT)
    expect(await getStats(request)).toMatchObject({ total: 1, open: 0, resolvedByAi: 1 })
    expect(await averageOf(request)).not.toBeNull()

    const suffix = uniqueSuffix()
    const res = await request.post('/api/webhooks/inbound-email', {
      headers: { 'X-Inbound-Secret': inboundSecret() },
      data: {
        senderEmail: `customer-${suffix}@example.com`,
        senderName: `Customer ${suffix}`,
        subject: `Re: ${ticket.subject}`,
        body: 'That did not fix it.',
        messageId: `<stats-reply-${suffix}@example.com>`,
        inReplyTo: messageId,
      },
    })
    expect(res.status()).toBe(201)
    expect(await res.json()).toEqual({ ticket: { id: ticket.id }, reply: { id: expect.any(Number) } })

    expect(await getStats(request)).toEqual({ total: 1, open: 1, resolvedByAi: 0, averageResolutionMs: null })
  })
})
