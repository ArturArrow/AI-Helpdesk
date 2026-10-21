import { expect, test, type APIRequestContext } from '@playwright/test'
import { ADMIN, AGENT, signInViaApi, type Credentials } from '../fixtures/auth.js'
import { createTicketViaWebhook } from '../fixtures/tickets.js'
import { createUserViaApi, deleteUserViaApi } from '../fixtures/users.js'

// GET and POST /api/tickets/:id/replies, at the API only (the thread and the form are covered
// by component tests). Each test creates its own ticket through the webhook, so a thread holds
// exactly the replies the test posted.

type Reply = {
  id: number
  body: string
  bodyHTML: string | null
  sender: string
  createdAt: string
  author: { id: string; name: string } | null
}

const REPLY_KEYS = ['author', 'body', 'bodyHTML', 'createdAt', 'id', 'sender']
const TICKET_ID_ERROR = 'id must be a positive integer'
const EMPTY_ERROR = "Reply can't be empty"
const TOO_LONG_ERROR = 'Reply is too long'
// Postgres int4's maximum: a valid id that no ticket in the test DB reaches.
const MISSING_ID = 2147483647

async function currentUserId(request: APIRequestContext): Promise<string> {
  const res = await request.get('/api/me')
  expect(res.status()).toBe(200)
  return (await res.json()).user.id
}

// GET /api/tickets/:id/replies, asserts 200 and exactly `{ replies }`, returns the replies.
async function listReplies(request: APIRequestContext, ticketId: number): Promise<Reply[]> {
  const res = await request.get(`/api/tickets/${ticketId}/replies`)
  expect(res.status(), `list replies of ticket ${ticketId}`).toBe(200)
  const json = await res.json()
  expect(Object.keys(json)).toEqual(['replies'])
  return json.replies
}

// POST /api/tickets/:id/replies, asserts 201 and exactly `{ reply }`, returns the reply.
async function postReply(request: APIRequestContext, ticketId: number, body: string): Promise<Reply> {
  const res = await request.post(`/api/tickets/${ticketId}/replies`, { data: { body } })
  expect(res.status(), `reply to ticket ${ticketId}`).toBe(201)
  const json = await res.json()
  expect(Object.keys(json)).toEqual(['reply'])
  return json.reply
}

test.describe('replies without a session', () => {
  test('GET gets 401 for an existing id and for abc', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'reply-401-get')
    for (const id of [ticket.id, 'abc']) {
      const res = await request.get(`/api/tickets/${id}/replies`)
      expect(res.status(), `GET id ${id}`).toBe(401)
      expect(await res.json()).toEqual({ error: 'Unauthorized' })
    }
  })

  test('POST gets 401 for an existing id and for abc, and stores nothing', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'reply-401-post')
    for (const id of [ticket.id, 'abc']) {
      const res = await request.post(`/api/tickets/${id}/replies`, { data: { body: 'Sneaky reply' } })
      expect(res.status(), `POST id ${id}`).toBe(401)
      expect(await res.json()).toEqual({ error: 'Unauthorized' })
    }

    await signInViaApi(request, AGENT)
    expect(await listReplies(request, ticket.id)).toEqual([])
  })
})

test.describe('POST /api/tickets/:id/replies', () => {
  for (const user of [AGENT, ADMIN] as Credentials[]) {
    test(`the ${user.name.toLowerCase()} replies: 201 with a trimmed body, sender agent and themselves as author`, async ({ request }) => {
      const ticket = await createTicketViaWebhook(request, `reply-${user.name.toLowerCase()}`)
      await signInViaApi(request, user)
      const userId = await currentUserId(request)

      const before = Date.now()
      const reply = await postReply(request, ticket.id, '  Thanks, we are on it.\n ')

      expect(Object.keys(reply).sort()).toEqual(REPLY_KEYS)
      expect(reply).toMatchObject({
        body: 'Thanks, we are on it.',
        sender: 'agent',
        author: { id: userId, name: user.name },
      })
      expect(Object.keys(reply.author!).sort()).toEqual(['id', 'name'])
      expect(typeof reply.id).toBe('number')
      const createdAt = Date.parse(reply.createdAt)
      expect(createdAt).not.toBeNaN()
      // Allow for clock skew between the test runner and the database.
      expect(createdAt).toBeGreaterThan(before - 60_000)

      expect(await listReplies(request, ticket.id)).toEqual([reply])
    })
  }

  test('a client-supplied sender and authorId are ignored', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'reply-spoof')
    await signInViaApi(request, ADMIN)
    const adminId = await currentUserId(request)
    await signInViaApi(request, AGENT)
    const agentId = await currentUserId(request)

    const res = await request.post(`/api/tickets/${ticket.id}/replies`, {
      data: { body: 'Spoofed?', sender: 'customer', authorId: adminId },
    })
    expect(res.status()).toBe(201)
    const { reply } = await res.json()
    expect(reply).toMatchObject({ body: 'Spoofed?', sender: 'agent', author: { id: agentId, name: AGENT.name } })

    expect(await listReplies(request, ticket.id)).toEqual([reply])
  })

  test('an agent reply has bodyHTML null in the 201 and in the GET list', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'reply-html-null')
    await signInViaApi(request, AGENT)

    const reply = await postReply(request, ticket.id, 'Plain text only')
    expect(reply).toHaveProperty('bodyHTML', null)

    const [listed] = await listReplies(request, ticket.id)
    expect(listed).toHaveProperty('bodyHTML', null)
    expect(listed).toEqual(reply)
  })

  test('a client-supplied bodyHTML is ignored and stored as null', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'reply-html-spoof')
    await signInViaApi(request, AGENT)

    const res = await request.post(`/api/tickets/${ticket.id}/replies`, {
      data: { body: 'With HTML?', bodyHTML: '<p>With <b>HTML</b>?</p>' },
    })
    expect(res.status()).toBe(201)
    const { reply } = await res.json()
    expect(reply).toMatchObject({ body: 'With HTML?', sender: 'agent' })
    expect(reply).toHaveProperty('bodyHTML', null)

    expect(await listReplies(request, ticket.id)).toEqual([reply])
  })

  test('a body of exactly 10,000 characters is accepted', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'reply-max')
    await signInViaApi(request, AGENT)
    const body = 'x'.repeat(10_000)

    const reply = await postReply(request, ticket.id, body)
    expect(reply.body).toBe(body)
  })

  const invalidBodies: [string, unknown, string][] = [
    ['an empty body', { body: '' }, EMPTY_ERROR],
    ['a whitespace-only body', { body: ' \n\t ' }, EMPTY_ERROR],
    ['a missing body', {}, EMPTY_ERROR],
    ['a numeric body', { body: 1 }, EMPTY_ERROR],
    ['a null body', { body: null }, EMPTY_ERROR],
    ['a 10,001-character body', { body: 'x'.repeat(10_001) }, TOO_LONG_ERROR],
  ]
  for (const [label, data, error] of invalidBodies) {
    test(`${label} gets 400 ${JSON.stringify(error)} and stores nothing`, async ({ request }) => {
      const ticket = await createTicketViaWebhook(request, 'reply-invalid')
      await signInViaApi(request, AGENT)

      const res = await request.post(`/api/tickets/${ticket.id}/replies`, { data })
      expect(res.status()).toBe(400)
      expect(await res.json()).toEqual({ error })

      expect(await listReplies(request, ticket.id)).toEqual([])
    })
  }

  for (const id of ['abc', '0', '-1', '1.5', '2147483648']) {
    test(`id ${id} gets 400 ${JSON.stringify(TICKET_ID_ERROR)}`, async ({ request }) => {
      await signInViaApi(request, AGENT)
      const res = await request.post(`/api/tickets/${id}/replies`, { data: { body: 'Hello' } })
      expect(res.status()).toBe(400)
      expect(await res.json()).toEqual({ error: TICKET_ID_ERROR })
    })
  }

  test('an invalid id with an empty body gets the id error (params are checked first)', async ({ request }) => {
    await signInViaApi(request, AGENT)
    const res = await request.post('/api/tickets/abc/replies', { data: { body: '' } })
    expect(res.status()).toBe(400)
    expect(await res.json()).toEqual({ error: TICKET_ID_ERROR })
  })

  test(`a valid but nonexistent id (${MISSING_ID}) gets 404`, async ({ request }) => {
    await signInViaApi(request, AGENT)
    const res = await request.post(`/api/tickets/${MISSING_ID}/replies`, { data: { body: 'Hello' } })
    expect(res.status()).toBe(404)
    expect(await res.json()).toEqual({ error: 'Ticket not found' })
  })
})

test.describe('GET /api/tickets/:id/replies', () => {
  test('a ticket with no replies returns []', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'reply-none')
    await signInViaApi(request, AGENT)
    expect(await listReplies(request, ticket.id)).toEqual([])
  })

  test('returns the replies oldest first, from both the agent and the admin', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'reply-order')
    await signInViaApi(request, AGENT)
    const first = await postReply(request, ticket.id, 'First reply')
    await signInViaApi(request, ADMIN)
    const second = await postReply(request, ticket.id, 'Second reply')
    await signInViaApi(request, AGENT)
    const third = await postReply(request, ticket.id, 'Third reply')

    const replies = await listReplies(request, ticket.id)
    expect(replies).toEqual([first, second, third])
    expect(replies.map((r) => r.author?.name)).toEqual([AGENT.name, ADMIN.name, AGENT.name])
    for (const reply of replies) expect(Object.keys(reply).sort()).toEqual(REPLY_KEYS)
    const times = replies.map((r) => Date.parse(r.createdAt))
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  test("returns only that ticket's replies", async ({ request }) => {
    const ticketA = await createTicketViaWebhook(request, 'reply-scope-a')
    const ticketB = await createTicketViaWebhook(request, 'reply-scope-b')
    const ticketC = await createTicketViaWebhook(request, 'reply-scope-c')
    await signInViaApi(request, AGENT)
    const a1 = await postReply(request, ticketA.id, 'A one')
    const b1 = await postReply(request, ticketB.id, 'B one')
    const a2 = await postReply(request, ticketA.id, 'A two')

    expect(await listReplies(request, ticketA.id)).toEqual([a1, a2])
    expect(await listReplies(request, ticketB.id)).toEqual([b1])
    expect(await listReplies(request, ticketC.id)).toEqual([])
  })

  for (const user of [AGENT, ADMIN] as Credentials[]) {
    test(`the ${user.name.toLowerCase()} reads a thread written by the other user`, async ({ request }) => {
      const other = user === AGENT ? ADMIN : AGENT
      const ticket = await createTicketViaWebhook(request, 'reply-read')
      await signInViaApi(request, other)
      const reply = await postReply(request, ticket.id, `Written by ${other.name}`)

      await signInViaApi(request, user)
      expect(await listReplies(request, ticket.id)).toEqual([reply])
    })
  }

  test('a reply by an agent who is later soft-deleted still shows them as author', async ({ request, playwright, baseURL }) => {
    const ticket = await createTicketViaWebhook(request, 'reply-deleted-author')
    await signInViaApi(request, ADMIN)
    const author = await createUserViaApi(request, 'reply-author')

    const authorCtx = await playwright.request.newContext({ baseURL })
    let reply: Reply
    try {
      await signInViaApi(authorCtx, author)
      reply = await postReply(authorCtx, ticket.id, 'Written before my account was deleted')
    } finally {
      await authorCtx.dispose()
    }
    expect(reply.author).toEqual({ id: author.id, name: author.name })

    await deleteUserViaApi(request, author.id)

    // Display only: the author select doesn't filter deletedAt, like the ticket's assignedTo.
    expect(await listReplies(request, ticket.id)).toEqual([reply])
    await signInViaApi(request, AGENT)
    expect(await listReplies(request, ticket.id)).toEqual([reply])
  })

  for (const id of ['abc', '0', '-1', '1.5', '2147483648']) {
    test(`id ${id} gets 400 ${JSON.stringify(TICKET_ID_ERROR)}`, async ({ request }) => {
      await signInViaApi(request, AGENT)
      const res = await request.get(`/api/tickets/${id}/replies`)
      expect(res.status()).toBe(400)
      expect(await res.json()).toEqual({ error: TICKET_ID_ERROR })
    })
  }

  test(`a valid but nonexistent id (${MISSING_ID}) gets 404`, async ({ request }) => {
    await signInViaApi(request, AGENT)
    const res = await request.get(`/api/tickets/${MISSING_ID}/replies`)
    expect(res.status()).toBe(404)
    expect(await res.json()).toEqual({ error: 'Ticket not found' })
  })
})
