import { expect, test } from '@playwright/test'
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

