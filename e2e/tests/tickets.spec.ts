import { expect, test, type APIRequestContext } from '@playwright/test'
import { ADMIN, AGENT, signInViaApi } from '../fixtures/auth.js'
import { createTicketViaWebhook, updateTicketViaApi, type TicketUpdate } from '../fixtures/tickets.js'
import { createUserViaApi, deleteUserViaApi, uniqueSuffix } from '../fixtures/users.js'
import { inboundSecret } from '../fixtures/webhook.js'

// Other specs create tickets in the same database and the list is paginated (10 per page by
// default), so these tests narrow each list to their own tickets with `q=<unique token>`, or ask
// for `pageSize=100` when a check covers every row. They compare relative order, never absolute
// positions or counts, except where `q` makes the matching set exactly the test's own tickets.

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

      const res = await request.get('/api/tickets', { params: { q: ticket.subject } })
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
    const { tickets: found } = await (await request.get('/api/tickets', { params: { q: suffix } })).json()
    const ticket = found.find((t: ListedTicket) => t.id === created.id)

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

    // Every row of a full page has the same keys, and the response is just `tickets` and `total`.
    const body = await (await request.get('/api/tickets', { params: { pageSize: '100' } })).json()
    expect(Object.keys(body).sort()).toEqual(['tickets', 'total'])
    expect(body.total).toEqual(expect.any(Number))
    const tickets: ListedTicket[] = body.tickets
    expect(tickets.length).toBeGreaterThan(0)
    for (const t of tickets) {
      expect(Object.keys(t).sort()).toEqual(
        ['category', 'createdAt', 'id', 'senderEmail', 'senderName', 'status', 'subject'],
      )
    }
  })

  test('tickets are ordered newest first', async ({ request }) => {
    const token = `E2E order ${uniqueSuffix()}`
    const first = await createTicketViaWebhook(request, 'first', { subject: `${token} first` })
    const second = await createTicketViaWebhook(request, 'second', { subject: `${token} second` })
    const third = await createTicketViaWebhook(request, 'third', { subject: `${token} third` })
    await signInViaApi(request, AGENT)

    const { tickets: ours } = await (await request.get('/api/tickets', { params: { q: token } })).json()
    const ids: number[] = ours.map((t: ListedTicket) => t.id)
    const positions = [third.id, second.id, first.id].map((id) => ids.indexOf(id))

    expect(positions).not.toContain(-1)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))

    // A full page is newest first too, not just our three.
    const { tickets } = await (await request.get('/api/tickets', { params: { pageSize: '100' } })).json()
    const times: number[] = tickets.map((t: { createdAt: string }) => Date.parse(t.createdAt))
    expect(times).toEqual([...times].sort((a, b) => b - a))
  })
})


type SortedTicket = ListedTicket & {
  senderName: string
  senderEmail: string
  status: string
  category: string | null
  createdAt: string
}

// GETs /api/tickets with the given sort, filter, search and paging params, asserts 200 and
// returns the whole body.
async function getTicketPage(
  request: APIRequestContext,
  params: Record<string, string>,
): Promise<{ tickets: SortedTicket[]; total: number }> {
  const res = await request.get('/api/tickets', { params })
  expect(res.status(), `GET /api/tickets ${new URLSearchParams(params)}`).toBe(200)
  return res.json()
}

// Same as getTicketPage, returning only the tickets.
async function listTickets(request: APIRequestContext, params: Record<string, string>): Promise<SortedTicket[]> {
  return (await getTicketPage(request, params)).tickets
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

      const tickets = await listTickets(request, { q: prefix, sortBy: 'subject', sortOrder })
      expectInOrder(tickets, sortOrder === 'asc' ? [a.id, b.id, c.id] : [c.id, b.id, a.id])
    })
  }

  test('sortBy=senderName orders sender names, descending by default and ascending with asc', async ({ request }) => {
    const prefix = `E2E sender ${uniqueSuffix()}`
    const b = await createTicketViaWebhook(request, 'b', { senderName: `${prefix} B` })
    const a = await createTicketViaWebhook(request, 'a', { senderName: `${prefix} A` })
    const c = await createTicketViaWebhook(request, 'c', { senderName: `${prefix} C` })
    await signInViaApi(request, ADMIN)

    expectInOrder(await listTickets(request, { q: prefix, sortBy: 'senderName' }), [c.id, b.id, a.id])
    expectInOrder(await listTickets(request, { q: prefix, sortBy: 'senderName', sortOrder: 'asc' }), [a.id, b.id, c.id])
  })

  test('equal subjects fall back to newest first in both directions', async ({ request }) => {
    const subject = `E2E same subject ${uniqueSuffix()}`
    const older = await createTicketViaWebhook(request, 'older', { subject })
    const newer = await createTicketViaWebhook(request, 'newer', { subject })
    await signInViaApi(request, AGENT)

    for (const sortOrder of ['asc', 'desc']) {
      expectInOrder(await listTickets(request, { q: subject, sortBy: 'subject', sortOrder }), [newer.id, older.id])
    }
  })

  test('sortBy=createdAt&sortOrder=asc lists oldest first', async ({ request }) => {
    const token = `E2E oldest ${uniqueSuffix()}`
    const first = await createTicketViaWebhook(request, 'first', { subject: `${token} first` })
    const second = await createTicketViaWebhook(request, 'second', { subject: `${token} second` })
    const third = await createTicketViaWebhook(request, 'third', { subject: `${token} third` })
    await signInViaApi(request, AGENT)

    expectInOrder(await listTickets(request, { q: token, sortBy: 'createdAt', sortOrder: 'asc' }), [first.id, second.id, third.id])

    // A full page is oldest first too.
    const tickets = await listTickets(request, { sortBy: 'createdAt', sortOrder: 'asc', pageSize: '100' })
    const times = tickets.map((t) => Date.parse(t.createdAt))
    expect(times).toEqual([...times].sort((x, y) => x - y))
  })

  // The webhook creates only unclassified tickets and nothing sets a category yet, so this can only
  // check that null categories don't break the sort and that the newest-first tie-break holds.
  test('sortBy=category succeeds with unclassified tickets, newest first among equals', async ({ request }) => {
    const token = `E2E category sort ${uniqueSuffix()}`
    const first = await createTicketViaWebhook(request, 'first', { subject: `${token} first` })
    const second = await createTicketViaWebhook(request, 'second', { subject: `${token} second` })
    const third = await createTicketViaWebhook(request, 'third', { subject: `${token} third` })
    await signInViaApi(request, AGENT)

    for (const sortOrder of ['asc', 'desc']) {
      const tickets = await listTickets(request, { q: token, sortBy: 'category', sortOrder })
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

const STATUS_ERROR = 'status must be one of: open, resolved, closed'
const CATEGORY_ERROR = 'category must be one of: general_question, technical_question, refund_request, unclassified'

type FilterParams = { status?: string; category?: string }

// Every row matches the status and category filters (`unclassified` means a null category).
function expectRowsMatch(tickets: SortedTicket[], params: FilterParams) {
  for (const t of tickets) {
    if (params.status) expect(t.status).toBe(params.status)
    if (params.category) expect(t.category).toBe(params.category === 'unclassified' ? null : params.category)
  }
}

// Narrowed to the ticket's subject, the filter lists or drops it; on a full page of the filter,
// every row matches.
async function expectFilter(request: APIRequestContext, params: FilterParams, ticketId: number, subject: string, listed: boolean) {
  const ids = (await listTickets(request, { ...params, q: subject })).map((t) => t.id)
  if (listed) expect(ids).toContain(ticketId)
  else expect(ids).not.toContain(ticketId)
  expectRowsMatch(await listTickets(request, { ...params, pageSize: '100' }), params)
}

// The webhook creates only open, unclassified tickets, so these tests show that a filter keeps or
// drops the test's own new ticket and that every returned row matches. The other statuses and
// categories may come back empty here; the PATCH tests below check that a changed ticket is listed.
test.describe('GET /api/tickets filtering', () => {
  test('401 without a session, with valid or invalid filter params', async ({ request }) => {
    for (const params of [{ status: 'open', category: 'unclassified' }, { status: 'nope', category: 'nope' }]) {
      const res = await request.get('/api/tickets', { params })
      expect(res.status()).toBe(401)
      expect(await res.json()).toEqual({ error: 'Unauthorized' })
    }
  })

  test('status=open lists the new ticket and only open tickets', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request)
    await signInViaApi(request, AGENT)

    await expectFilter(request, { status: 'open' }, ticket.id, ticket.subject, true)
  })

  test('category=unclassified lists the new ticket and only tickets with a null category', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request)
    await signInViaApi(request, AGENT)

    await expectFilter(request, { category: 'unclassified' }, ticket.id, ticket.subject, true)
  })

  for (const status of ['resolved', 'closed']) {
    test(`status=${status} excludes the new open ticket and lists only ${status} tickets`, async ({ request }) => {
      const ticket = await createTicketViaWebhook(request)
      await signInViaApi(request, AGENT)

      await expectFilter(request, { status }, ticket.id, ticket.subject, false)
    })
  }

  for (const category of ['general_question', 'technical_question', 'refund_request']) {
    test(`category=${category} excludes the new unclassified ticket and lists only that category`, async ({ request }) => {
      const ticket = await createTicketViaWebhook(request)
      await signInViaApi(request, AGENT)

      await expectFilter(request, { category }, ticket.id, ticket.subject, false)
    })
  }

  test('filters combine: open + unclassified keeps the ticket, open + a category or resolved + unclassified drops it', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request)
    await signInViaApi(request, ADMIN)

    await expectFilter(request, { status: 'open', category: 'unclassified' }, ticket.id, ticket.subject, true)
    for (const params of [{ status: 'open', category: 'refund_request' }, { status: 'resolved', category: 'unclassified' }]) {
      await expectFilter(request, params, ticket.id, ticket.subject, false)
    }
  })

  for (const sortOrder of ['asc', 'desc']) {
    test(`filters with sortBy=subject&sortOrder=${sortOrder} still sort the matching tickets`, async ({ request }) => {
      const prefix = `E2E filter sort ${uniqueSuffix()}`
      const b = await createTicketViaWebhook(request, 'b', { subject: `${prefix} B` })
      const c = await createTicketViaWebhook(request, 'c', { subject: `${prefix} C` })
      const a = await createTicketViaWebhook(request, 'a', { subject: `${prefix} A` })
      await signInViaApi(request, AGENT)

      const tickets = await listTickets(request, {
        q: prefix,
        status: 'open',
        category: 'unclassified',
        sortBy: 'subject',
        sortOrder,
      })
      expectInOrder(tickets, sortOrder === 'asc' ? [a.id, b.id, c.id] : [c.id, b.id, a.id])
      expectRowsMatch(tickets, { status: 'open', category: 'unclassified' })
    })
  }

  // `unclassified` is a category filter only; `Open` checks the match is case-sensitive.
  for (const status of ['pending', 'Open', 'unclassified', '']) {
    test(`status=${JSON.stringify(status)} gets 400 with the allowed statuses`, async ({ request }) => {
      await signInViaApi(request, AGENT)
      const res = await request.get('/api/tickets', { params: { status } })
      expect(res.status()).toBe(400)
      expect(await res.json()).toEqual({ error: STATUS_ERROR })
    })
  }

  // `open` is a status, not a category.
  for (const category of ['billing', 'Refund_Request', 'open', '']) {
    test(`category=${JSON.stringify(category)} gets 400 with the allowed categories`, async ({ request }) => {
      await signInViaApi(request, AGENT)
      const res = await request.get('/api/tickets', { params: { category } })
      expect(res.status()).toBe(400)
      expect(await res.json()).toEqual({ error: CATEGORY_ERROR })
    })
  }

  test('a repeated status param gets 400 instead of filtering on either value', async ({ request }) => {
    await signInViaApi(request, AGENT)
    const res = await request.get('/api/tickets?status=open&status=closed')
    expect(res.status()).toBe(400)
    expect(await res.json()).toEqual({ error: STATUS_ERROR })
  })

  test('an invalid filter gets 400 even with a valid sort', async ({ request }) => {
    await signInViaApi(request, AGENT)
    const res = await request.get('/api/tickets', { params: { sortBy: 'subject', sortOrder: 'asc', category: 'nope' } })
    expect(res.status()).toBe(400)
    expect(await res.json()).toEqual({ error: CATEGORY_ERROR })
  })
})

type SearchField = 'subject' | 'senderName' | 'senderEmail' | 'body'

// The value that puts `token` into one field of a webhook email, leaving the others at the
// helper's defaults (which never contain the token).
function searchOverride(field: SearchField, token: string) {
  if (field === 'senderEmail') return { senderEmail: `${token}@example.com` }
  return { [field]: `Search ${token} here` }
}

// Every listed ticket holds `text` (case-insensitively) in one of the fields the list returns.
function expectAllContain(tickets: SortedTicket[], text: string) {
  const needle = text.toLowerCase()
  for (const t of tickets) {
    const haystack = [t.subject, t.senderName, t.senderEmail].join('\n').toLowerCase()
    expect(haystack, `ticket ${t.id}`).toContain(needle)
  }
}

// Each test searches for a token unique to that test, so the matching set is exactly the test's
// own tickets, whatever other specs have created.
test.describe('GET /api/tickets search (q)', () => {
  test('401 without a session, with a valid or invalid q', async ({ request }) => {
    for (const url of ['/api/tickets?q=refund', `/api/tickets?q=${'a'.repeat(201)}`, '/api/tickets?q=a&q=b']) {
      const res = await request.get(url)
      expect(res.status(), url).toBe(401)
      expect(await res.json()).toEqual({ error: 'Unauthorized' })
    }
  })

  for (const field of ['subject', 'senderName', 'senderEmail', 'body'] as const) {
    test(`q finds a ticket by a token only in its ${field}, and not a ticket without it`, async ({ request }) => {
      const token = `srch${field}${uniqueSuffix()}`
      const ticket = await createTicketViaWebhook(request, 'match', searchOverride(field, token))
      const other = await createTicketViaWebhook(request, 'other')
      await signInViaApi(request, AGENT)

      const tickets = await listTickets(request, { q: token })
      const ids = tickets.map((t) => t.id)
      expect(ids).toEqual([ticket.id])
      expect(ids).not.toContain(other.id)
      // `body` isn't in the list response, so only the other fields can be checked on the rows.
      if (field !== 'body') expectAllContain(tickets, token)
    })
  }

  test('q is case-insensitive', async ({ request }) => {
    const token = `MixedCase${uniqueSuffix()}`
    const ticket = await createTicketViaWebhook(request, 'case', { subject: `Search ${token} here` })
    await signInViaApi(request, AGENT)

    for (const q of [token.toUpperCase(), token.toLowerCase()]) {
      expect((await listTickets(request, { q })).map((t) => t.id), q).toEqual([ticket.id])
    }
  })

  test('leading and trailing spaces in q are trimmed', async ({ request }) => {
    const token = `trim${uniqueSuffix()}`
    const ticket = await createTicketViaWebhook(request, 'trim', { subject: `Search ${token} here` })
    await signInViaApi(request, AGENT)

    const tickets = await listTickets(request, { q: `   ${token}  ` })
    expect(tickets.map((t) => t.id)).toEqual([ticket.id])
  })

  test('a whitespace-only or empty q returns the same list as no q', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request)
    await signInViaApi(request, AGENT)

    // The new ticket is the newest, so it is on the first page of 100.
    const all = await getTicketPage(request, { pageSize: '100' })
    const allIds = all.tickets.map((t) => t.id)
    expect(allIds).toContain(ticket.id)
    for (const url of ['/api/tickets?pageSize=100&q=%20%20', '/api/tickets?pageSize=100&q=']) {
      const res = await request.get(url)
      expect(res.status(), url).toBe(200)
      const body = await res.json()
      expect(body.tickets.map((t: ListedTicket) => t.id), url).toEqual(allIds)
      expect(body.total, url).toBe(all.total)
    }
  })

  for (const sortOrder of ['asc', 'desc']) {
    test(`q combines with status=open and sortBy=subject&sortOrder=${sortOrder}`, async ({ request }) => {
      const token = `combo${uniqueSuffix()}`
      const b = await createTicketViaWebhook(request, 'b', { subject: `${token} B` })
      const c = await createTicketViaWebhook(request, 'c', { subject: `${token} C` })
      const a = await createTicketViaWebhook(request, 'a', { subject: `${token} A` })
      const other = await createTicketViaWebhook(request, 'other')
      await signInViaApi(request, AGENT)

      const tickets = await listTickets(request, { q: token, status: 'open', sortBy: 'subject', sortOrder })
      expect(tickets.map((t) => t.id)).toEqual(sortOrder === 'asc' ? [a.id, b.id, c.id] : [c.id, b.id, a.id])
      expect(tickets.map((t) => t.id)).not.toContain(other.id)
      for (const t of tickets) expect(t.status).toBe('open')

      // The status filter still applies: the same q with status=resolved drops them all.
      expect(await listTickets(request, { q: token, status: 'resolved', sortBy: 'subject', sortOrder })).toEqual([])
    })
  }

  test('% and _ in q match literally, not as LIKE wildcards', async ({ request }) => {
    const suffix = uniqueSuffix()
    const token = `50%_off-${suffix}`
    const ticket = await createTicketViaWebhook(request, 'wild', { subject: `Sale ${token} today` })
    // Matches `50%_off-<suffix>` only if % and _ act as wildcards.
    const decoy = await createTicketViaWebhook(request, 'decoy', { subject: `Sale 50ABoff-${suffix} today` })
    await signInViaApi(request, AGENT)

    const tickets = await listTickets(request, { q: token })
    expect(tickets.map((t) => t.id)).toEqual([ticket.id])
    expect(tickets.map((t) => t.id)).not.toContain(decoy.id)
  })

  for (const char of ['%', '_']) {
    test(`q=${char} matches only tickets containing a literal ${char}`, async ({ request }) => {
      const withChar = await createTicketViaWebhook(request, 'with', { subject: `E2E has ${char} ${uniqueSuffix()}` })
      // The helper's default subject, sender, email and body contain neither % nor _.
      const plain = await createTicketViaWebhook(request, 'plain')
      await signInViaApi(request, AGENT)

      const ids = (await listTickets(request, { q: char, pageSize: '100' })).map((t) => t.id)
      expect(ids).toContain(withChar.id)
      expect(ids).not.toContain(plain.id)
    })
  }

  test('a backslash in q matches literally', async ({ request }) => {
    const suffix = uniqueSuffix()
    const token = `back\\slash-${suffix}`
    const ticket = await createTicketViaWebhook(request, 'backslash', { subject: `Path ${token} here` })
    // Unescaped, `\s` in LIKE is just `s`, so the query would match this subject too.
    const decoy = await createTicketViaWebhook(request, 'decoy', { subject: `Path backslash-${suffix} here` })
    await signInViaApi(request, AGENT)

    const tickets = await listTickets(request, { q: token })
    expect(tickets.map((t) => t.id)).toEqual([ticket.id])
    expect(tickets.map((t) => t.id)).not.toContain(decoy.id)
    expect(tickets[0].subject).toBe(`Path ${token} here`)
  })

  test('a q of 201 characters gets 400 and exactly 200 characters gets 200', async ({ request }) => {
    await signInViaApi(request, AGENT)

    const tooLong = await request.get('/api/tickets', { params: { q: 'a'.repeat(201) } })
    expect(tooLong.status()).toBe(400)
    expect(await tooLong.json()).toEqual({ error: 'q is too long' })

    const atLimit = await request.get('/api/tickets', { params: { q: 'a'.repeat(200) } })
    expect(atLimit.status()).toBe(200)
    expect(await atLimit.json()).toEqual({ tickets: expect.any(Array), total: expect.any(Number) })
  })

  test('a repeated q param gets 400 instead of searching for either value', async ({ request }) => {
    await signInViaApi(request, AGENT)
    const res = await request.get('/api/tickets?q=a&q=b')
    expect(res.status()).toBe(400)
    expect(await res.json()).toEqual({ error: 'q must be a single string' })
  })
})

const PAGE_ERROR = 'page must be a positive integer'
const PAGE_SIZE_ERROR = 'pageSize must be an integer from 1 to 100'

// Creates one ticket per label, in the given order, each with the subject `<token> <label>`.
async function createTicketsWithToken(request: APIRequestContext, token: string, labels: string[]) {
  const created = []
  for (const label of labels) {
    created.push(await createTicketViaWebhook(request, label, { subject: `${token} ${label}` }))
  }
  return created
}

// Each test narrows the list with `q=<its own token>`, so `total` is exactly its own tickets.
test.describe('GET /api/tickets pagination (page, pageSize)', () => {
  test('401 without a session, with valid or invalid paging params', async ({ request }) => {
    for (const url of ['/api/tickets?page=2&pageSize=5', '/api/tickets?page=0&pageSize=101', '/api/tickets?page=abc']) {
      const res = await request.get(url)
      expect(res.status(), url).toBe(401)
      expect(await res.json()).toEqual({ error: 'Unauthorized' })
    }
  })

  test('pageSize=2 splits 5 tickets into pages of 2, 2 and 1 that together equal the unpaginated list', async ({ request }) => {
    const token = `pages${uniqueSuffix()}`
    const created = await createTicketsWithToken(request, token, ['one', 'two', 'three', 'four', 'five'])
    await signInViaApi(request, AGENT)

    const full = await getTicketPage(request, { q: token })
    expect(full.total).toBe(5)
    const fullIds = full.tickets.map((t) => t.id)
    // Newest first.
    expect(fullIds).toEqual(created.map((t) => t.id).reverse())

    const pages = []
    for (const page of ['1', '2', '3']) {
      const res = await getTicketPage(request, { q: token, pageSize: '2', page })
      expect(res.total, `page ${page}`).toBe(5)
      pages.push(res.tickets.map((t) => t.id))
    }
    expect(pages.map((ids) => ids.length)).toEqual([2, 2, 1])
    const joined = pages.flat()
    expect(new Set(joined).size).toBe(joined.length)
    expect(joined).toEqual(fullIds)
  })

  test('pagination with sortBy=subject&sortOrder=asc returns consecutive slices of the sorted order', async ({ request }) => {
    const token = `pagesort${uniqueSuffix()}`
    // Created out of alphabetical order, so creation order can't produce the expected result.
    const [d, b, e, a, c] = await createTicketsWithToken(request, token, ['D', 'B', 'E', 'A', 'C'])
    await signInViaApi(request, AGENT)

    const sort = { q: token, sortBy: 'subject', sortOrder: 'asc' }
    const sortedIds = [a.id, b.id, c.id, d.id, e.id]
    expect((await listTickets(request, sort)).map((t) => t.id)).toEqual(sortedIds)

    const pages = []
    for (const page of ['1', '2', '3']) {
      const res = await getTicketPage(request, { ...sort, pageSize: '2', page })
      expect(res.total, `page ${page}`).toBe(5)
      pages.push(res.tickets.map((t) => t.id))
    }
    expect(pages).toEqual([[a.id, b.id], [c.id, d.id], [e.id]])
  })

  test('a page past the end returns no tickets and the real total', async ({ request }) => {
    const token = `pastend${uniqueSuffix()}`
    await createTicketsWithToken(request, token, ['one', 'two', 'three', 'four', 'five'])
    await signInViaApi(request, AGENT)

    expect(await getTicketPage(request, { q: token, pageSize: '2', page: '4' })).toEqual({ tickets: [], total: 5 })
  })

  test('total counts only tickets matching the filters', async ({ request }) => {
    const token = `total${uniqueSuffix()}`
    const [ticket] = await createTicketsWithToken(request, token, ['only'])
    await signInViaApi(request, ADMIN)

    const matching = await getTicketPage(request, { q: token })
    expect(matching.total).toBe(1)
    expect(matching.tickets.map((t) => t.id)).toEqual([ticket.id])

    expect(await getTicketPage(request, { q: `nomatch${uniqueSuffix()}` })).toEqual({ tickets: [], total: 0 })
    expect(await getTicketPage(request, { q: token, status: 'resolved' })).toEqual({ tickets: [], total: 0 })
  })

  test('without pageSize a page holds at most 10 tickets and total is the full count', async ({ request }) => {
    // DEFAULT_TICKET_PAGE_SIZE in core/src/schemas/tickets.ts. Restated because the root tsconfig
    // can't resolve `core` (not a root dependency, and its extensionless imports fail under nodenext).
    const defaultPageSize = 10
    await createTicketViaWebhook(request)
    await signInViaApi(request, AGENT)

    const page = await getTicketPage(request, {})
    expect(page.total).toBeGreaterThan(0)
    // Exactly the default whenever the database holds more tickets than that.
    expect(page.tickets.length).toBe(Math.min(page.total, defaultPageSize))

    // Same as asking for the default pageSize explicitly; a bigger page reports the same total.
    const explicit = await getTicketPage(request, { pageSize: String(defaultPageSize) })
    expect(explicit.tickets.map((t) => t.id)).toEqual(page.tickets.map((t) => t.id))
    const bigger = await getTicketPage(request, { pageSize: '100' })
    expect(bigger.total).toBe(page.total)
    expect(bigger.tickets.length).toBe(Math.min(page.total, 100))
  })

  const invalid: [string, string][] = [
    ['page=0', PAGE_ERROR],
    ['page=-1', PAGE_ERROR],
    ['page=abc', PAGE_ERROR],
    ['page=1.5', PAGE_ERROR],
    ['page=', PAGE_ERROR],
    ['page=1&page=2', PAGE_ERROR],
    ['page=1000001', 'page is too large'],
    ['pageSize=0', PAGE_SIZE_ERROR],
    ['pageSize=101', PAGE_SIZE_ERROR],
    ['pageSize=abc', PAGE_SIZE_ERROR],
    ['pageSize=2&pageSize=3', PAGE_SIZE_ERROR],
  ]
  for (const [query, error] of invalid) {
    test(`${query} gets 400 ${JSON.stringify(error)}`, async ({ request }) => {
      await signInViaApi(request, AGENT)
      const res = await request.get(`/api/tickets?${query}`)
      expect(res.status()).toBe(400)
      expect(await res.json()).toEqual({ error })
    })
  }

  test('pageSize=100 and page=1000000 (the maximums) get 200', async ({ request }) => {
    await signInViaApi(request, AGENT)

    const maxSize = await getTicketPage(request, { pageSize: '100' })
    expect(maxSize.tickets.length).toBeLessThanOrEqual(100)

    const maxPage = await getTicketPage(request, { page: '1000000' })
    expect(maxPage).toEqual({ tickets: [], total: expect.any(Number) })
  })
})

const TICKET_ID_ERROR = 'id must be a positive integer'
const DETAIL_KEYS = ['assignedTo', 'body', 'bodyHTML', 'category', 'createdAt', 'id', 'senderEmail', 'senderName', 'status', 'subject', 'updatedAt']

test.describe('GET /api/tickets/:id', () => {
  test('401 without a session, for an existing and an invalid id', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'detail-401')

    for (const id of [String(ticket.id), 'abc']) {
      const res = await request.get(`/api/tickets/${id}`)
      expect(res.status(), `id ${id}`).toBe(401)
      expect(await res.json()).toEqual({ error: 'Unauthorized' })
    }
  })

  for (const user of [AGENT, ADMIN]) {
    test(`200 for the ${user.name.toLowerCase()}`, async ({ request }) => {
      const ticket = await createTicketViaWebhook(request, 'detail-read')
      await signInViaApi(request, user)

      const res = await request.get(`/api/tickets/${ticket.id}`)
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.ticket).toMatchObject({ id: ticket.id, subject: ticket.subject })
    })
  }

  for (const id of ['abc', '0', '-1', '1.5', '2147483648']) {
    test(`id ${id} gets 400 ${JSON.stringify(TICKET_ID_ERROR)}`, async ({ request }) => {
      await signInViaApi(request, AGENT)
      const res = await request.get(`/api/tickets/${id}`)
      expect(res.status()).toBe(400)
      expect(await res.json()).toEqual({ error: TICKET_ID_ERROR })
    })
  }

  test('a valid but nonexistent id (2147483647, the int4 maximum) gets 404', async ({ request }) => {
    await signInViaApi(request, AGENT)
    const res = await request.get('/api/tickets/2147483647')
    expect(res.status()).toBe(404)
    expect(await res.json()).toEqual({ error: 'Ticket not found' })
  })

  test('returns exactly the detail fields, with the stored bodyHTML, assignedTo null and no messageId or assignedToId', async ({ request }) => {
    const suffix = uniqueSuffix()
    const created = await request.post('/api/webhooks/inbound-email', {
      headers: { 'X-Inbound-Secret': inboundSecret() },
      data: {
        subject: `E2E detail ${suffix}`,
        senderName: `Customer ${suffix}`,
        senderEmail: `customer-${suffix}@example.com`,
        body: 'Plain body',
        bodyHTML: '<p>HTML body</p>',
        messageId: `<detail-${suffix}@example.com>`,
      },
    })
    expect(created.status()).toBe(201)
    const { ticket: { id } } = await created.json()

    await signInViaApi(request, AGENT)
    const res = await request.get(`/api/tickets/${id}`)
    expect(res.status()).toBe(200)
    const body = await res.json()

    expect(Object.keys(body)).toEqual(['ticket'])
    expect(Object.keys(body.ticket).sort()).toEqual(DETAIL_KEYS)
    expect(body.ticket).toEqual({
      id,
      subject: `E2E detail ${suffix}`,
      senderName: `Customer ${suffix}`,
      senderEmail: `customer-${suffix}@example.com`,
      status: 'open',
      category: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      body: 'Plain body',
      bodyHTML: '<p>HTML body</p>',
      assignedTo: null,
    })
    expect(body.ticket).not.toHaveProperty('messageId')
    expect(body.ticket).not.toHaveProperty('assignedToId')
    expect(Number.isNaN(Date.parse(body.ticket.createdAt))).toBe(false)
    expect(Number.isNaN(Date.parse(body.ticket.updatedAt))).toBe(false)
  })

  test('bodyHTML is the raw HTML as sent to the webhook, not sanitized', async ({ request }) => {
    // The server stores and returns the sender's HTML as is; sanitizing is the client's job.
    const html = '<div class="x"><p onclick="alert(1)">Hi <b>there</b></p><script>alert(2)</script></div>'
    const ticket = await createTicketViaWebhook(request, 'detail-raw-html', { bodyHTML: html })

    await signInViaApi(request, AGENT)
    const res = await request.get(`/api/tickets/${ticket.id}`)
    expect(res.status()).toBe(200)
    expect((await res.json()).ticket.bodyHTML).toBe(html)
  })

  test('a ticket created without bodyHTML has bodyHTML null', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'detail-no-html')

    await signInViaApi(request, AGENT)
    const res = await request.get(`/api/tickets/${ticket.id}`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Object.keys(body.ticket).sort()).toEqual(DETAIL_KEYS)
    expect(body.ticket.bodyHTML).toBeNull()
  })

  test('an assigned ticket has assignedTo { id, name } of the agent', async ({ request }) => {
    await signInViaApi(request, ADMIN)
    const agent = await createUserViaApi(request, 'assignee')
    const ticket = await createTicketViaWebhook(request, 'detail-assigned')
    await updateTicketViaApi(request, ticket.id, { assignedToId: agent.id })

    await signInViaApi(request, AGENT)
    const res = await request.get(`/api/tickets/${ticket.id}`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.ticket.assignedTo).toEqual({ id: agent.id, name: agent.name })
    expect(body.ticket).not.toHaveProperty('assignedToId')
  })
})

// The signed-in user's id, from /api/me.
async function currentUserId(request: APIRequestContext): Promise<string> {
  const res = await request.get('/api/me')
  expect(res.status()).toBe(200)
  return (await res.json()).user.id
}

type Assignee = { id: string; name: string }

async function listAssignees(request: APIRequestContext): Promise<Assignee[]> {
  const res = await request.get('/api/tickets/assignees')
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(Object.keys(body)).toEqual(['agents'])
  return body.agents
}

test.describe('GET /api/tickets/assignees', () => {
  test('401 without a session', async ({ request }) => {
    const res = await request.get('/api/tickets/assignees')
    expect(res.status()).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  for (const user of [AGENT, ADMIN]) {
    test(`200 for the ${user.name.toLowerCase()}, listing the seeded agent with exactly id and name`, async ({ request }) => {
      await signInViaApi(request, AGENT)
      const agentId = await currentUserId(request)
      await signInViaApi(request, user)

      const agents = await listAssignees(request)
      expect(agents).toContainEqual({ id: agentId, name: AGENT.name })
      for (const agent of agents) {
        expect(Object.keys(agent).sort()).toEqual(['id', 'name'])
      }
    })
  }

  test('the admin is not listed', async ({ request }) => {
    await signInViaApi(request, ADMIN)
    const adminId = await currentUserId(request)

    const agents = await listAssignees(request)
    expect(agents.map((a) => a.id)).not.toContain(adminId)
  })

  test('a soft-deleted agent is not listed, an active one is', async ({ request }) => {
    await signInViaApi(request, ADMIN)
    const kept = await createUserViaApi(request, 'assignee-kept')
    const deleted = await createUserViaApi(request, 'assignee-deleted')
    await deleteUserViaApi(request, deleted.id)

    const ids = (await listAssignees(request)).map((a) => a.id)
    expect(ids).toContain(kept.id)
    expect(ids).not.toContain(deleted.id)
  })

  test('agents are ordered by name ascending', async ({ request }) => {
    // createUserViaApi names users `E2E <label> <suffix>`, so these sort by the label's last
    // lower-case letter under any collation. Created out of order, so createdAt order would fail.
    await signInViaApi(request, ADMIN)
    const b = await createUserViaApi(request, 'assignee-order-b')
    const c = await createUserViaApi(request, 'assignee-order-c')
    const a = await createUserViaApi(request, 'assignee-order-a')
    const ids = [a.id, b.id, c.id]

    await signInViaApi(request, AGENT)
    const listed = (await listAssignees(request)).map((agent) => agent.id).filter((id) => ids.includes(id))
    expect(listed).toEqual(ids)
  })
})

const ASSIGNEE_ERROR = 'assignedToId must be an active agent'
const ASSIGNED_TO_ID_ERROR = 'assignedToId must be a user id or null'

test.describe('PATCH /api/tickets/:id', () => {
  test('401 without a session, for an existing and an invalid id; the ticket stays unassigned', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'patch-401')

    // Auth runs before validation and the assignee lookup, so any id answers 401.
    for (const id of [String(ticket.id), 'abc']) {
      const res = await request.patch(`/api/tickets/${id}`, { data: { assignedToId: 'any-user-id' } })
      expect(res.status(), `id ${id}`).toBe(401)
      expect(await res.json()).toEqual({ error: 'Unauthorized' })
    }

    await signInViaApi(request, AGENT)
    const res = await request.get(`/api/tickets/${ticket.id}`)
    expect((await res.json()).ticket.assignedTo).toBeNull()
  })

  for (const user of [AGENT, ADMIN]) {
    test(`the ${user.name.toLowerCase()} assigns a ticket to an active agent: 200 with the detail shape, persisted, updatedAt advances`, async ({ request }) => {
      await signInViaApi(request, ADMIN)
      const agent = await createUserViaApi(request, 'patch-assignee')
      const ticket = await createTicketViaWebhook(request, 'patch-assign')
      await signInViaApi(request, user)
      const before = (await (await request.get(`/api/tickets/${ticket.id}`)).json()).ticket

      const res = await request.patch(`/api/tickets/${ticket.id}`, { data: { assignedToId: agent.id } })
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(Object.keys(body)).toEqual(['ticket'])
      expect(Object.keys(body.ticket).sort()).toEqual(DETAIL_KEYS)
      expect(body.ticket).toEqual({
        ...before,
        assignedTo: { id: agent.id, name: agent.name },
        updatedAt: expect.any(String),
      })
      // createTicketViaWebhook sends no bodyHTML, so the PATCH response carries it as null.
      expect(body.ticket.bodyHTML).toBeNull()
      expect(body.ticket).not.toHaveProperty('assignedToId')
      expect(Date.parse(body.ticket.updatedAt)).toBeGreaterThan(Date.parse(before.updatedAt))

      const after = await request.get(`/api/tickets/${ticket.id}`)
      expect(after.status()).toBe(200)
      expect((await after.json()).ticket).toEqual(body.ticket)
    })

    test(`the ${user.name.toLowerCase()} unassigns a ticket with null`, async ({ request }) => {
      await signInViaApi(request, ADMIN)
      const agent = await createUserViaApi(request, 'patch-unassignee')
      const ticket = await createTicketViaWebhook(request, 'patch-unassign')
      await updateTicketViaApi(request, ticket.id, { assignedToId: agent.id })
      await signInViaApi(request, user)

      const res = await request.patch(`/api/tickets/${ticket.id}`, { data: { assignedToId: null } })
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(Object.keys(body.ticket).sort()).toEqual(DETAIL_KEYS)
      expect(body.ticket).toMatchObject({ id: ticket.id, assignedTo: null })

      const after = await request.get(`/api/tickets/${ticket.id}`)
      expect((await after.json()).ticket.assignedTo).toBeNull()
    })
  }

  test('reassigning replaces the previous assignee', async ({ request }) => {
    await signInViaApi(request, ADMIN)
    const first = await createUserViaApi(request, 'patch-first')
    const second = await createUserViaApi(request, 'patch-second')
    const ticket = await createTicketViaWebhook(request, 'patch-reassign')
    await updateTicketViaApi(request, ticket.id, { assignedToId: first.id })

    const reassigned = await updateTicketViaApi(request, ticket.id, { assignedToId: second.id })
    expect(reassigned.assignedTo).toEqual({ id: second.id, name: second.name })
  })

  test('the PATCH response carries the stored bodyHTML, unchanged', async ({ request }) => {
    const html = '<p>Stored <i>HTML</i></p>'
    const ticket = await createTicketViaWebhook(request, 'patch-html', { bodyHTML: html })
    await signInViaApi(request, AGENT)

    const updated = await updateTicketViaApi(request, ticket.id, { status: 'resolved' })
    expect(Object.keys(updated).sort()).toEqual(DETAIL_KEYS)
    expect(updated.bodyHTML).toBe(html)
  })

  test('a valid but nonexistent id (2147483647) gets 404', async ({ request }) => {
    await signInViaApi(request, AGENT)
    const agentId = await currentUserId(request)
    const res = await request.patch('/api/tickets/2147483647', { data: { assignedToId: agentId } })
    expect(res.status()).toBe(404)
    expect(await res.json()).toEqual({ error: 'Ticket not found' })
  })

  test(`id abc gets 400 ${JSON.stringify(TICKET_ID_ERROR)}`, async ({ request }) => {
    await signInViaApi(request, AGENT)
    const agentId = await currentUserId(request)
    const res = await request.patch('/api/tickets/abc', { data: { assignedToId: agentId } })
    expect(res.status()).toBe(400)
    expect(await res.json()).toEqual({ error: TICKET_ID_ERROR })
  })

  const notAssignable: [string, (request: APIRequestContext) => Promise<string>][] = [
    ['an unknown user id', async () => `no-such-user-${uniqueSuffix()}`],
    ['the admin\'s id', async (request) => {
      await signInViaApi(request, ADMIN)
      return currentUserId(request)
    }],
    ['a soft-deleted agent\'s id', async (request) => {
      await signInViaApi(request, ADMIN)
      const agent = await createUserViaApi(request, 'patch-deleted')
      await deleteUserViaApi(request, agent.id)
      return agent.id
    }],
  ]
  for (const [label, makeId] of notAssignable) {
    test(`${label} gets 400 ${JSON.stringify(ASSIGNEE_ERROR)} and the ticket is unchanged`, async ({ request }) => {
      const ticket = await createTicketViaWebhook(request, 'patch-not-assignable')
      const assignedToId = await makeId(request)
      await signInViaApi(request, AGENT)

      const res = await request.patch(`/api/tickets/${ticket.id}`, { data: { assignedToId } })
      expect(res.status()).toBe(400)
      expect(await res.json()).toEqual({ error: ASSIGNEE_ERROR })

      const after = await request.get(`/api/tickets/${ticket.id}`)
      expect((await after.json()).ticket.assignedTo).toBeNull()
    })
  }

  test('a missing assignedToId with no other field gets the empty-body 400, not the assignedToId one', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'patch-missing-assignee')
    await signInViaApi(request, AGENT)

    const res = await request.patch(`/api/tickets/${ticket.id}`, { data: {} })
    expect(res.status()).toBe(400)
    expect(await res.json()).toEqual({ error: EMPTY_UPDATE_ERROR })
  })
})

const UPDATE_STATUS_ERROR = 'status must be one of: open, resolved, closed'
const UPDATE_CATEGORY_ERROR = 'category must be one of: general_question, technical_question, refund_request, or null'
const EMPTY_UPDATE_ERROR = 'Provide at least one of assignedToId, status, category'

type TicketDetail = {
  id: number
  status: string
  category: string | null
  assignedTo: { id: string; name: string } | null
  updatedAt: string
}

// GETs /api/tickets/:id, asserts 200 and returns the ticket.
async function getTicket(request: APIRequestContext, id: number): Promise<TicketDetail> {
  const res = await request.get(`/api/tickets/${id}`)
  expect(res.status(), `GET /api/tickets/${id}`).toBe(200)
  return (await res.json()).ticket
}

// PATCHes `data` onto the ticket and asserts the 200 response is exactly `before` with `changes`
// applied and a later updatedAt (so every other field is untouched), and that a following GET
// returns the same ticket. Returns it, as the `before` of the next step.
async function expectUpdated(
  request: APIRequestContext,
  before: TicketDetail,
  data: TicketUpdate,
  changes: Partial<TicketDetail>,
): Promise<TicketDetail> {
  const res = await request.patch(`/api/tickets/${before.id}`, { data })
  expect(res.status(), `PATCH ${JSON.stringify(data)}`).toBe(200)
  const body = await res.json()
  expect(Object.keys(body)).toEqual(['ticket'])
  expect(Object.keys(body.ticket).sort()).toEqual(DETAIL_KEYS)
  expect(body.ticket).toEqual({ ...before, ...changes, updatedAt: expect.any(String) })
  expect(Date.parse(body.ticket.updatedAt)).toBeGreaterThan(Date.parse(before.updatedAt))
  expect(await getTicket(request, before.id)).toEqual(body.ticket)
  return body.ticket
}

test.describe('PATCH /api/tickets/:id status and category', () => {
  test('401 for a status change without a session; the ticket stays open', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'patch-status-401')

    const res = await request.patch(`/api/tickets/${ticket.id}`, { data: { status: 'resolved' } })
    expect(res.status()).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })

    await signInViaApi(request, AGENT)
    expect((await getTicket(request, ticket.id)).status).toBe('open')
  })

  for (const user of [AGENT, ADMIN]) {
    test(`the ${user.name.toLowerCase()} changes status open → resolved → closed → open, each returned, persisted and advancing updatedAt`, async ({ request }) => {
      const ticket = await createTicketViaWebhook(request, 'patch-status')
      await signInViaApi(request, user)
      let current = await getTicket(request, ticket.id)
      expect(current.status).toBe('open')

      for (const status of ['resolved', 'closed', 'open']) {
        current = await expectUpdated(request, current, { status }, { status })
      }
    })

    test(`the ${user.name.toLowerCase()} classifies an unclassified ticket, changes the category and sets it back to null`, async ({ request }) => {
      const ticket = await createTicketViaWebhook(request, 'patch-category')
      await signInViaApi(request, user)
      let current = await getTicket(request, ticket.id)
      expect(current.category).toBeNull()

      for (const category of ['general_question', 'refund_request', null]) {
        current = await expectUpdated(request, current, { category }, { category })
      }
    })
  }

  test('a single-field PATCH leaves the other fields untouched', async ({ request }) => {
    await signInViaApi(request, ADMIN)
    const first = await createUserViaApi(request, 'patch-keep-first')
    const second = await createUserViaApi(request, 'patch-keep-second')
    const ticket = await createTicketViaWebhook(request, 'patch-keep')
    await updateTicketViaApi(request, ticket.id, { assignedToId: first.id, status: 'resolved', category: 'technical_question' })
    await signInViaApi(request, AGENT)
    let current = await getTicket(request, ticket.id)
    expect(current).toMatchObject({
      status: 'resolved',
      category: 'technical_question',
      assignedTo: { id: first.id, name: first.name },
    })

    // Status keeps the assignee and category, category keeps the status and assignee, and
    // (re)assigning or unassigning keeps the status and category.
    current = await expectUpdated(request, current, { status: 'closed' }, { status: 'closed' })
    current = await expectUpdated(request, current, { category: 'refund_request' }, { category: 'refund_request' })
    current = await expectUpdated(request, current, { assignedToId: second.id }, { assignedTo: { id: second.id, name: second.name } })
    current = await expectUpdated(request, current, { assignedToId: null }, { assignedTo: null })
    expect(current).toMatchObject({ status: 'closed', category: 'refund_request' })
  })

  test('one PATCH with assignedToId, status and category applies all three', async ({ request }) => {
    await signInViaApi(request, ADMIN)
    const agent = await createUserViaApi(request, 'patch-all')
    const ticket = await createTicketViaWebhook(request, 'patch-all')
    await signInViaApi(request, AGENT)
    const before = await getTicket(request, ticket.id)
    expect(before).toMatchObject({ status: 'open', category: null, assignedTo: null })

    await expectUpdated(
      request,
      before,
      { assignedToId: agent.id, status: 'resolved', category: 'refund_request' },
      { assignedTo: { id: agent.id, name: agent.name }, status: 'resolved', category: 'refund_request' },
    )
  })

  const invalidBodies: [string, object, string][] = [
    ['an empty body', {}, EMPTY_UPDATE_ERROR],
    ['a body with only an unknown field', { subject: 'Changed' }, EMPTY_UPDATE_ERROR],
    ['status "pending"', { status: 'pending' }, UPDATE_STATUS_ERROR],
    ['status "Open" (case-sensitive)', { status: 'Open' }, UPDATE_STATUS_ERROR],
    ['status null', { status: null }, UPDATE_STATUS_ERROR],
    ['status 1', { status: 1 }, UPDATE_STATUS_ERROR],
    ['category "billing"', { category: 'billing' }, UPDATE_CATEGORY_ERROR],
    ['category "unclassified" (a list filter, not a value)', { category: 'unclassified' }, UPDATE_CATEGORY_ERROR],
    ['category ""', { category: '' }, UPDATE_CATEGORY_ERROR],
    ['category 1', { category: 1 }, UPDATE_CATEGORY_ERROR],
    ['a valid status with an invalid category', { status: 'resolved', category: 'billing' }, UPDATE_CATEGORY_ERROR],
    ['a valid category with an invalid status', { category: 'refund_request', status: 'pending' }, UPDATE_STATUS_ERROR],
    ['an empty assignedToId', { assignedToId: '' }, ASSIGNED_TO_ID_ERROR],
    ['a blank assignedToId', { assignedToId: '   ' }, ASSIGNED_TO_ID_ERROR],
    ['a numeric assignedToId', { assignedToId: 123 }, ASSIGNED_TO_ID_ERROR],
    ['a valid status with an empty assignedToId', { status: 'resolved', assignedToId: '' }, ASSIGNED_TO_ID_ERROR],
  ]
  for (const [label, data, error] of invalidBodies) {
    test(`${label} gets 400 ${JSON.stringify(error)} and the ticket is unchanged`, async ({ request }) => {
      const ticket = await createTicketViaWebhook(request, 'patch-invalid-body')
      await signInViaApi(request, AGENT)
      const before = await getTicket(request, ticket.id)

      const res = await request.patch(`/api/tickets/${ticket.id}`, { data })
      expect(res.status()).toBe(400)
      expect(await res.json()).toEqual({ error })

      expect(await getTicket(request, ticket.id)).toEqual(before)
    })
  }

  test(`a valid status and category with the admin's id as assignedToId get 400 ${JSON.stringify(ASSIGNEE_ERROR)} and change nothing`, async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'patch-partial-invalid')
    await signInViaApi(request, ADMIN)
    const adminId = await currentUserId(request)
    await signInViaApi(request, AGENT)
    const before = await getTicket(request, ticket.id)

    const res = await request.patch(`/api/tickets/${ticket.id}`, {
      data: { status: 'resolved', category: 'general_question', assignedToId: adminId },
    })
    expect(res.status()).toBe(400)
    expect(await res.json()).toEqual({ error: ASSIGNEE_ERROR })

    const after = await getTicket(request, ticket.id)
    expect(after).toEqual(before)
    expect(after).toMatchObject({ status: 'open', category: null, assignedTo: null })
  })

  test('GET /api/tickets filters follow a status and category change', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'patch-filters')
    await signInViaApi(request, AGENT)
    await expectFilter(request, { status: 'resolved' }, ticket.id, ticket.subject, false)

    await updateTicketViaApi(request, ticket.id, { status: 'resolved' })
    await expectFilter(request, { status: 'resolved' }, ticket.id, ticket.subject, true)
    await expectFilter(request, { status: 'open' }, ticket.id, ticket.subject, false)

    await updateTicketViaApi(request, ticket.id, { category: 'refund_request' })
    await expectFilter(request, { category: 'refund_request' }, ticket.id, ticket.subject, true)
    await expectFilter(request, { category: 'unclassified' }, ticket.id, ticket.subject, false)
    await expectFilter(request, { status: 'resolved', category: 'refund_request' }, ticket.id, ticket.subject, true)
  })
})
