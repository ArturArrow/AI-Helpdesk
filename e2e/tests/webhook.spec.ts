import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { ADMIN, signInViaApi } from '../fixtures/auth.js'
import { uniqueSuffix } from '../fixtures/users.js'
import { inboundSecret } from '../fixtures/webhook.js'

// The route answers with `{ ticket: { id } }` only, and there is no endpoint to read tickets
// back yet, so these tests check the wire response, not the stored row.

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

test.describe('POST /api/webhooks/inbound-email: validation', () => {
  const cases: [string, (email: ReturnType<typeof validEmail>) => object, string][] = [
    ['missing senderEmail', ({ senderEmail: _, ...rest }) => rest, 'senderEmail is required'],
    ['invalid senderEmail', (email) => ({ ...email, senderEmail: 'not-an-email' }), 'senderEmail must be a valid email address'],
    ['missing senderName', ({ senderName: _, ...rest }) => rest, 'senderName is required'],
    ['missing body', ({ body: _, ...rest }) => rest, 'body is required'],
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

  test('a body over 100 kB gets a JSON 413', async ({ request }) => {
    const res = await postInbound(request, { ...validEmail(), body: 'x'.repeat(150 * 1024) })
    expect(res.status()).toBe(413)
    expect(await res.json()).toEqual({ error: expect.any(String) })
  })
})
