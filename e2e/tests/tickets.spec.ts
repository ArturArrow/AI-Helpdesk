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


type SortedTicket = ListedTicket & {
  senderName: string
  senderEmail: string
  status: string
  category: string | null
  createdAt: string
}

// GETs /api/tickets with the given sort and filter params and asserts 200.
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

const STATUS_ERROR = 'status must be one of: open, resolved, closed'
const CATEGORY_ERROR = 'category must be one of: general_question, technical_question, refund_request, unclassified'

// The webhook creates only open, unclassified tickets and nothing changes them yet, so these tests
// can show that a filter keeps or drops the test's own ticket and that every returned row matches.
// The other statuses and categories may come back empty.
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

    const tickets = await listTickets(request, { status: 'open' })
    expect(tickets.map((t) => t.id)).toContain(ticket.id)
    for (const t of tickets) expect(t.status).toBe('open')
  })

  test('category=unclassified lists the new ticket and only tickets with a null category', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request)
    await signInViaApi(request, AGENT)

    const tickets = await listTickets(request, { category: 'unclassified' })
    expect(tickets.map((t) => t.id)).toContain(ticket.id)
    for (const t of tickets) expect(t.category).toBeNull()
  })

  for (const status of ['resolved', 'closed']) {
    test(`status=${status} excludes the new open ticket and lists only ${status} tickets`, async ({ request }) => {
      const ticket = await createTicketViaWebhook(request)
      await signInViaApi(request, AGENT)

      const tickets = await listTickets(request, { status })
      expect(tickets.map((t) => t.id)).not.toContain(ticket.id)
      for (const t of tickets) expect(t.status).toBe(status)
    })
  }

  for (const category of ['general_question', 'technical_question', 'refund_request']) {
    test(`category=${category} excludes the new unclassified ticket and lists only that category`, async ({ request }) => {
      const ticket = await createTicketViaWebhook(request)
      await signInViaApi(request, AGENT)

      const tickets = await listTickets(request, { category })
      expect(tickets.map((t) => t.id)).not.toContain(ticket.id)
      for (const t of tickets) expect(t.category).toBe(category)
    })
  }

  test('filters combine: open + unclassified keeps the ticket, open + a category or resolved + unclassified drops it', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request)
    await signInViaApi(request, ADMIN)

    const both = await listTickets(request, { status: 'open', category: 'unclassified' })
    expect(both.map((t) => t.id)).toContain(ticket.id)
    for (const t of both) {
      expect(t.status).toBe('open')
      expect(t.category).toBeNull()
    }

    for (const params of [{ status: 'open', category: 'refund_request' }, { status: 'resolved', category: 'unclassified' }]) {
      const tickets = await listTickets(request, params)
      expect(tickets.map((t) => t.id)).not.toContain(ticket.id)
      for (const t of tickets) {
        expect(t.status).toBe(params.status)
        expect(t.category).toBe(params.category === 'unclassified' ? null : params.category)
      }
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
        status: 'open',
        category: 'unclassified',
        sortBy: 'subject',
        sortOrder,
      })
      expectInOrder(tickets, sortOrder === 'asc' ? [a.id, b.id, c.id] : [c.id, b.id, a.id])
      for (const t of tickets) {
        expect(t.status).toBe('open')
        expect(t.category).toBeNull()
      }
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

    const all = (await listTickets(request, {})).map((t) => t.id)
    expect(all).toContain(ticket.id)
    for (const url of ['/api/tickets?q=%20%20', '/api/tickets?q=']) {
      const res = await request.get(url)
      expect(res.status(), url).toBe(200)
      expect((await res.json()).tickets.map((t: ListedTicket) => t.id), url).toEqual(all)
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

      const ids = (await listTickets(request, { q: char })).map((t) => t.id)
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
    expect(await atLimit.json()).toEqual({ tickets: expect.any(Array) })
  })

  test('a repeated q param gets 400 instead of searching for either value', async ({ request }) => {
    await signInViaApi(request, AGENT)
    const res = await request.get('/api/tickets?q=a&q=b')
    expect(res.status()).toBe(400)
    expect(await res.json()).toEqual({ error: 'q must be a single string' })
  })
})
