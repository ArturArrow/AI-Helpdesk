import { expect, test, type APIRequestContext } from '@playwright/test'
import { ADMIN, signInViaApi } from '../fixtures/auth.js'
import { uniqueSuffix } from '../fixtures/users.js'
import { inboundSecret } from '../fixtures/webhook.js'

const ENDPOINT = '/api/webhooks/inbound-email'

const validEmail = () => ({
  senderEmail: 'Customer@Example.com',
  senderName: 'Customer',
  subject: 'Printer on fire',
  body: 'It is still burning.',
})

function postInbound(request: APIRequestContext, data: unknown, secret: string | null = inboundSecret()) {
  return request.post(ENDPOINT, {
    headers: secret === null ? {} : { 'X-Inbound-Secret': secret },
    data,
  })
}

test.describe('POST /api/webhooks/inbound-email', () => {
  test('401 without the secret header or with a wrong one', async ({ request }) => {
    for (const secret of [null, 'wrong-secret']) {
      const res = await postInbound(request, validEmail(), secret)
      expect(res.status(), `secret: ${secret}`).toBe(401)
      expect(await res.json()).toEqual({ error: 'Unauthorized' })
    }
  })

  test('401 for a signed-in admin without the secret: a session does not count', async ({ request }) => {
    await signInViaApi(request, ADMIN)
    const res = await postInbound(request, validEmail(), null)
    expect(res.status()).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  test('400 with the first validation message for invalid bodies', async ({ request }) => {
    const { senderEmail, senderName, body, ...rest } = validEmail()
    const cases: [string, object, string][] = [
      ['missing senderEmail', { senderName, body, ...rest }, 'senderEmail is required'],
      ['invalid senderEmail', { senderEmail: 'not-an-email', senderName, body }, 'senderEmail must be a valid email address'],
      ['missing senderName', { senderEmail, body }, 'senderName is required'],
      ['blank senderName', { senderEmail, senderName: '   ', body }, 'senderName is required'],
      ['missing body', { senderEmail, senderName }, 'body is required'],
      ['blank body', { senderEmail, senderName, body: '  \n ' }, 'body is required'],
    ]
    for (const [label, data, error] of cases) {
      const res = await postInbound(request, data)
      expect(res.status(), label).toBe(400)
      expect(await res.json(), label).toEqual({ error })
    }

    const malformed = await request.post(ENDPOINT, {
      headers: { 'X-Inbound-Secret': inboundSecret(), 'Content-Type': 'application/json' },
      data: '{"senderEmail": "broken',
    })
    expect(malformed.status()).toBe(400)
    expect(await malformed.json()).toEqual({ error: expect.any(String) })
  })

  test('201 with a numeric ticket id', async ({ request }) => {
    const res = await postInbound(request, {
      ...validEmail(),
      bodyHTML: '<p>It is still burning.</p>',
      messageId: `<happy-${uniqueSuffix()}@example.com>`,
    })
    expect(res.status()).toBe(201)
    expect(await res.json()).toEqual({ ticket: { id: expect.any(Number) } })
  })

  test('a repeated messageId returns the existing ticket with 200', async ({ request }) => {
    const data = { ...validEmail(), messageId: `<dedupe-${uniqueSuffix()}@example.com>` }

    const first = await postInbound(request, data)
    expect(first.status()).toBe(201)
    const { ticket } = await first.json()

    const again = await postInbound(request, data)
    expect(again.status()).toBe(200)
    expect(await again.json()).toEqual({ ticket: { id: ticket.id } })
  })

  test('posts without a messageId each create a ticket', async ({ request }) => {
    const first = await postInbound(request, validEmail())
    const second = await postInbound(request, validEmail())
    expect(first.status()).toBe(201)
    expect(second.status()).toBe(201)
    const [a, b] = [(await first.json()).ticket.id, (await second.json()).ticket.id]
    expect(typeof a).toBe('number')
    expect(b).not.toBe(a)
  })
})
