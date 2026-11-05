import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { ADMIN, AGENT, signInViaApi, type Credentials } from '../fixtures/auth.js'
import { addAiReplyInDb, createTicketViaWebhook, fileAttachment, type ListedAttachment } from '../fixtures/tickets.js'
import { AI_AGENT, createUserViaApi, deleteUserViaApi } from '../fixtures/users.js'

// GET and POST /api/tickets/:id/replies, as JSON and as a multipart form with files, at the API
// only (the thread and the form are covered by component tests). Each test creates its own ticket
// through the webhook, so a thread holds exactly the replies the test posted.

type Reply = {
  id: number
  body: string
  bodyHTML: string | null
  sender: string
  emailStatus: string | null
  sentAt: string | null
  createdAt: string
  author: { id: string; name: string } | null
  attachments: ListedAttachment[]
}

const REPLY_KEYS = ['attachments', 'author', 'body', 'bodyHTML', 'createdAt', 'emailStatus', 'id', 'sender', 'sentAt']
const TICKET_ID_ERROR = 'id must be a positive integer'
const EMPTY_ERROR = "Reply can't be empty"
const TOO_LONG_ERROR = 'Reply is too long'
// Postgres int4's maximum: a valid id that no ticket in the test DB reaches.
const MISSING_ID = 2147483647
// MAX_ATTACHMENT_BYTES and MAX_REPLY_ATTACHMENT_BYTES in core/src/constants/attachment.ts.
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_BYTES = 18 * 1024 * 1024

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

// A multipart form with these text fields, and the files in `fileField`.
function replyForm(fields: Record<string, string>, files: File[] = [], fileField = 'attachments'): FormData {
  const form = new FormData()
  for (const [name, value] of Object.entries(fields)) form.append(name, value)
  for (const file of files) form.append(fileField, file)
  return form
}

function fileOfSize(filename: string, size: number): File {
  return new File([Buffer.alloc(size, 'x')], filename, { type: 'application/octet-stream' })
}

// `count` one-byte files, named so that sorting them by name wouldn't match the order sent.
function filesNamed(count: number): File[] {
  return Array.from({ length: count }, (_, index) => fileOfSize(`file-${count - index}.txt`, 1))
}

// A file as the 201 and GET list it: exactly these keys, so also no `data`.
function listedFile(filename: string, contentType: string, size: number) {
  return { id: expect.any(Number), filename, contentType, size, contentId: null, tooLarge: false }
}

function sendForm(request: APIRequestContext, ticketId: number, form: FormData): Promise<APIResponse> {
  return request.post(`/api/tickets/${ticketId}/replies`, { multipart: form })
}

// POST as a multipart form, asserts 201 and exactly `{ reply }`, returns the reply.
async function postForm(request: APIRequestContext, ticketId: number, form: FormData): Promise<Reply> {
  const res = await sendForm(request, ticketId, form)
  expect(res.status(), `reply with a form to ticket ${ticketId}`).toBe(201)
  const json = await res.json()
  expect(Object.keys(json)).toEqual(['reply'])
  return json.reply
}

// GET /api/tickets/:id/attachments/:attachmentId, asserts 200.
async function download(request: APIRequestContext, ticketId: number, attachmentId: number): Promise<APIResponse> {
  const res = await request.get(`/api/tickets/${ticketId}/attachments/${attachmentId}`)
  expect(res.status(), `download attachment ${attachmentId}`).toBe(200)
  return res
}

// The ticket's own files, from GET /api/tickets/:id.
async function ticketAttachments(request: APIRequestContext, ticketId: number): Promise<ListedAttachment[]> {
  const res = await request.get(`/api/tickets/${ticketId}`)
  expect(res.status(), `get ticket ${ticketId}`).toBe(200)
  return (await res.json()).ticket.attachments
}

async function expectJsonError(res: APIResponse, status: number, error: string) {
  expect(res.status()).toBe(status)
  expect(res.headers()['content-type']).toContain('application/json')
  expect(await res.json()).toEqual({ error })
}

async function expectNothingStored(request: APIRequestContext, ticketId: number) {
  expect(await listReplies(request, ticketId)).toEqual([])
  expect(await ticketAttachments(request, ticketId)).toEqual([])
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
        emailStatus: null,
        sentAt: null,
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

  // JSON can't carry files: they come as a multipart form (below) or through the webhook, where
  // a customer reply's are checked in webhook.spec.ts.
  test('attachments sent in the POST body are ignored: the reply has none in the 201 or the GET list', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'reply-attachments')
    await signInViaApi(request, AGENT)

    const res = await request.post(`/api/tickets/${ticket.id}/replies`, {
      data: { body: 'With a file?', attachments: [fileAttachment('note.txt', 'text/plain', Buffer.from('hello'))] },
    })
    expect(res.status()).toBe(201)
    const { reply } = await res.json()
    expect(reply).toHaveProperty('attachments', [])

    const [listed] = await listReplies(request, ticket.id)
    expect(listed).toEqual(reply)
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

  // server/.env.test sets no MAILER_URL / MAILER_SECRET, so nothing is emailed or queued.
  test('without a mailer, a reply has emailStatus and sentAt null in the 201 and in the GET list', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'reply-no-mailer')
    await signInViaApi(request, AGENT)

    const reply = await postReply(request, ticket.id, 'Not emailed')
    expect(reply).toHaveProperty('emailStatus', null)
    expect(reply).toHaveProperty('sentAt', null)

    const [listed] = await listReplies(request, ticket.id)
    expect(listed).toHaveProperty('emailStatus', null)
    expect(listed).toHaveProperty('sentAt', null)
    expect(listed).toEqual(reply)
  })

  test('a client-supplied emailStatus, sentAt and messageId are ignored', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'reply-email-spoof')
    await signInViaApi(request, AGENT)

    const res = await request.post(`/api/tickets/${ticket.id}/replies`, {
      data: {
        body: 'Already sent?',
        emailStatus: 'sent',
        sentAt: '2026-01-01T00:00:00.000Z',
        messageId: `<reply-spoof-${Date.now()}@example.com>`,
      },
    })
    expect(res.status()).toBe(201)
    const { reply } = await res.json()
    expect(Object.keys(reply).sort()).toEqual(REPLY_KEYS)
    expect(reply).toMatchObject({ body: 'Already sent?', sender: 'agent', emailStatus: null, sentAt: null })

    expect(await listReplies(request, ticket.id)).toEqual([reply])
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

// POST /api/tickets/:id/replies as a multipart form. The error texts for size, count, field name
// and malformed bodies are multer's and busboy's, passed on by uploadAttachments in the route;
// they're asserted exactly because the status alone can't tell these 400s apart.
test.describe('POST /api/tickets/:id/replies with files', () => {
  test('stores the files: the 201 and GET list them in order, without data, and each downloads byte for byte', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'reply-files')
    await signInViaApi(request, AGENT)
    const userId = await currentUserId(request)
    const allBytes = Buffer.from(Array.from({ length: 256 }, (_, byte) => byte))
    const notes = Buffer.from('some notes\n')
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

    const reply = await postForm(
      request,
      ticket.id,
      replyForm({ body: '  Files attached.\n ' }, [
        new File([notes], 'zebra.txt', { type: 'text/plain' }),
        new File([allBytes], 'all-bytes.bin', { type: 'application/octet-stream' }),
        new File([image], 'middle.png', { type: 'image/png' }),
      ]),
    )

    expect(Object.keys(reply).sort()).toEqual(REPLY_KEYS)
    expect(reply).toMatchObject({ body: 'Files attached.', bodyHTML: null, sender: 'agent', emailStatus: null, sentAt: null })
    expect(reply.attachments).toEqual([
      listedFile('zebra.txt', 'text/plain', notes.length),
      listedFile('all-bytes.bin', 'application/octet-stream', 256),
      listedFile('middle.png', 'image/png', image.length),
    ])
    expect(reply.author?.id).toBe(userId)
    for (const attachment of reply.attachments) expect(attachment).not.toHaveProperty('data')

    expect(await listReplies(request, ticket.id)).toEqual([reply])

    const [first, second, third] = reply.attachments
    expect(await (await download(request, ticket.id, first.id)).body()).toEqual(notes)
    expect(await (await download(request, ticket.id, second.id)).body()).toEqual(allBytes)
    expect(await (await download(request, ticket.id, third.id)).body()).toEqual(image)
  })

  test("the ticket's own attachment list leaves out a reply's files", async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'reply-files-own-list', {
      attachments: [fileAttachment('from-customer.txt', 'text/plain', Buffer.from('original'))],
    })
    await signInViaApi(request, AGENT)

    const reply = await postForm(request, ticket.id, replyForm({ body: 'Here you go' }, [fileOfSize('from-agent.txt', 5)]))
    expect(reply.attachments).toEqual([listedFile('from-agent.txt', 'application/octet-stream', 5)])

    expect(await ticketAttachments(request, ticket.id)).toEqual([listedFile('from-customer.txt', 'text/plain', 8)])
  })

  test('a non-ASCII filename is stored and returned exactly', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'reply-files-utf8')
    await signInViaApi(request, AGENT)
    const filename = 'faktura-żółć.pdf'

    const reply = await postForm(
      request,
      ticket.id,
      replyForm({ body: 'Invoice attached' }, [new File([Buffer.from('%PDF')], filename, { type: 'application/pdf' })]),
    )
    expect(reply.attachments).toEqual([listedFile(filename, 'application/pdf', 4)])

    const [listed] = await listReplies(request, ticket.id)
    expect(listed.attachments[0].filename).toBe(filename)

    const res = await download(request, ticket.id, reply.attachments[0].id)
    expect(res.headers()['content-disposition']).toContain(`filename*=UTF-8''${encodeURIComponent(filename)}`)
  })

  test('a multipart reply with no files gets 201 and lists []', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'reply-files-none')
    await signInViaApi(request, AGENT)

    const reply = await postForm(request, ticket.id, replyForm({ body: 'No files this time' }))
    expect(reply).toMatchObject({ body: 'No files this time', sender: 'agent' })
    expect(reply.attachments).toEqual([])

    expect(await listReplies(request, ticket.id)).toEqual([reply])
  })

  test('a JSON reply still works next to a multipart one', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'reply-files-json')
    await signInViaApi(request, AGENT)

    const withFile = await postForm(request, ticket.id, replyForm({ body: 'With a file' }, [fileOfSize('note.txt', 1)]))
    const json = await postReply(request, ticket.id, 'Plain JSON')
    expect(json).toMatchObject({ body: 'Plain JSON', sender: 'agent' })
    expect(json.attachments).toEqual([])

    expect(await listReplies(request, ticket.id)).toEqual([withFile, json])
  })

  test('a file of exactly 10 MiB gets 201', async ({ request }) => {
    test.slow()
    const ticket = await createTicketViaWebhook(request, 'reply-files-max-file')
    await signInViaApi(request, AGENT)

    const reply = await postForm(request, ticket.id, replyForm({ body: 'Big file' }, [fileOfSize('big.bin', MAX_FILE_BYTES)]))
    expect(reply.attachments).toEqual([listedFile('big.bin', 'application/octet-stream', MAX_FILE_BYTES)])
  })

  test('a file of 10 MiB + 1 byte gets 413 and stores nothing', async ({ request }) => {
    test.slow()
    const ticket = await createTicketViaWebhook(request, 'reply-files-over-file')
    await signInViaApi(request, AGENT)

    const res = await sendForm(request, ticket.id, replyForm({ body: 'Too big' }, [fileOfSize('big.bin', MAX_FILE_BYTES + 1)]))
    await expectJsonError(res, 413, 'File too large')

    await expectNothingStored(request, ticket.id)
  })

  test('files of exactly 18 MiB in total get 201', async ({ request }) => {
    test.slow()
    const ticket = await createTicketViaWebhook(request, 'reply-files-max-total')
    await signInViaApi(request, AGENT)
    const rest = MAX_TOTAL_BYTES - MAX_FILE_BYTES

    const reply = await postForm(
      request,
      ticket.id,
      replyForm({ body: 'Two big files' }, [fileOfSize('one.bin', MAX_FILE_BYTES), fileOfSize('two.bin', rest)]),
    )
    expect(reply.attachments).toEqual([
      listedFile('one.bin', 'application/octet-stream', MAX_FILE_BYTES),
      listedFile('two.bin', 'application/octet-stream', rest),
    ])
  })

  test('files of 18 MiB + 1 byte in total, each within its limit, get 413 and store nothing', async ({ request }) => {
    test.slow()
    const ticket = await createTicketViaWebhook(request, 'reply-files-over-total')
    await signInViaApi(request, AGENT)
    const rest = MAX_TOTAL_BYTES - MAX_FILE_BYTES + 1

    const res = await sendForm(
      request,
      ticket.id,
      replyForm({ body: 'Too much' }, [fileOfSize('one.bin', MAX_FILE_BYTES), fileOfSize('two.bin', rest)]),
    )
    await expectJsonError(res, 413, 'Attachments are too large')

    await expectNothingStored(request, ticket.id)
  })

  test('10 files get 201, listed in order', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'reply-files-max-count')
    await signInViaApi(request, AGENT)

    const reply = await postForm(request, ticket.id, replyForm({ body: 'Ten files' }, filesNamed(10)))
    expect(reply.attachments.map((attachment) => attachment.filename)).toEqual(filesNamed(10).map((file) => file.name))
  })

  test('11 files get 400 and store nothing', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'reply-files-over-count')
    await signInViaApi(request, AGENT)

    const res = await sendForm(request, ticket.id, replyForm({ body: 'Eleven files' }, filesNamed(11)))
    await expectJsonError(res, 400, 'Too many files')

    await expectNothingStored(request, ticket.id)
  })

  test('a file in another field gets 400 and stores nothing', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'reply-files-field')
    await signInViaApi(request, AGENT)

    const res = await sendForm(request, ticket.id, replyForm({ body: 'Wrong field' }, [fileOfSize('note.txt', 1)], 'file'))
    await expectJsonError(res, 400, 'Unexpected file field')

    await expectNothingStored(request, ticket.id)
  })

  test('a file in another field, after one in attachments, gets 400 and stores neither', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'reply-files-field-mixed')
    await signInViaApi(request, AGENT)

    const form = replyForm({ body: 'One of each' }, [fileOfSize('good.txt', 1)])
    form.append('file', fileOfSize('bad.txt', 1))
    await expectJsonError(await sendForm(request, ticket.id, form), 400, 'Unexpected file field')

    await expectNothingStored(request, ticket.id)
  })

  const BOUNDARY = 'e2e-boundary'
  const bodyPart = `--${BOUNDARY}\r\ncontent-disposition: form-data; name="body"\r\n\r\nHello\r\n`
  const filePartHeader =
    `--${BOUNDARY}\r\ncontent-disposition: form-data; name="attachments"; filename="note.txt"\r\n` +
    'content-type: text/plain\r\n\r\n'
  const malformed: [string, string, string, string][] = [
    ['no closing boundary', `multipart/form-data; boundary=${BOUNDARY}`, bodyPart, 'Unexpected end of form'],
    ['a file cut off midway', `multipart/form-data; boundary=${BOUNDARY}`, `${bodyPart}${filePartHeader}hel`, 'Unexpected end of form'],
    ['no multipart content at all', `multipart/form-data; boundary=${BOUNDARY}`, 'not a form', 'Unexpected end of form'],
    [
      'a part header too long to parse',
      `multipart/form-data; boundary=${BOUNDARY}`,
      `--${BOUNDARY}\r\n${'x'.repeat(20_000)}\r\n\r\nHello\r\n--${BOUNDARY}--\r\n`,
      'Malformed part header',
    ],
    ['a Content-Type without a boundary', 'multipart/form-data', bodyPart, 'Multipart: Boundary not found'],
  ]
  for (const [label, contentType, data, error] of malformed) {
    test(`malformed multipart, ${label}: 400 as JSON, not 500, and nothing stored`, async ({ request }) => {
      const ticket = await createTicketViaWebhook(request, 'reply-files-malformed')
      await signInViaApi(request, AGENT)

      const res = await request.post(`/api/tickets/${ticket.id}/replies`, {
        headers: { 'Content-Type': contentType },
        data: Buffer.from(data),
      })
      await expectJsonError(res, 400, error)

      await expectNothingStored(request, ticket.id)
    })
  }

  const blankBodies: [string, Record<string, string>][] = [
    ['an empty body', { body: '' }],
    ['a whitespace-only body', { body: ' \n\t ' }],
    ['no body field', {}],
  ]
  for (const [label, fields] of blankBodies) {
    test(`${label} with a file gets 400 ${JSON.stringify(EMPTY_ERROR)} and stores nothing`, async ({ request }) => {
      const ticket = await createTicketViaWebhook(request, 'reply-files-blank')
      await signInViaApi(request, AGENT)

      const res = await sendForm(request, ticket.id, replyForm(fields, [fileOfSize('note.txt', 1)]))
      await expectJsonError(res, 400, EMPTY_ERROR)

      await expectNothingStored(request, ticket.id)
    })
  }

  test('without a session, a multipart POST gets 401 for an existing id and for abc, and stores nothing', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'reply-files-401')
    for (const id of [ticket.id, 'abc']) {
      const res = await request.post(`/api/tickets/${id}/replies`, {
        multipart: replyForm({ body: 'Sneaky file' }, [fileOfSize('note.txt', 1)]),
      })
      await expectJsonError(res, 401, 'Unauthorized')
    }

    await signInViaApi(request, AGENT)
    await expectNothingStored(request, ticket.id)
  })

  // A missing ticket has no list to read, so the proof is the attachment id sequence: with one
  // worker and no background jobs in E2E, nothing else inserts between the two uploads, and an
  // insert in the 404 request (even a failed one) would leave a gap.
  test(`a nonexistent ticket (${MISSING_ID}) with a file gets 404 and no attachment is stored`, async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'reply-files-404')
    await signInViaApi(request, AGENT)
    const form = () => replyForm({ body: 'With a file' }, [fileOfSize('note.txt', 1)])

    const before = await postForm(request, ticket.id, form())
    await expectJsonError(await sendForm(request, MISSING_ID, form()), 404, 'Ticket not found')
    const after = await postForm(request, ticket.id, form())

    expect(after.attachments[0].id).toBe(before.attachments[0].id + 1)
  })

  test("a reply's .html file keeps its type in the list and downloads as application/octet-stream", async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'reply-files-html')
    await signInViaApi(request, AGENT)
    const html = Buffer.from('<script>alert(1)</script>')

    const reply = await postForm(
      request,
      ticket.id,
      replyForm({ body: 'A page' }, [new File([html], 'page.html', { type: 'text/html' })]),
    )
    expect(reply.attachments).toEqual([listedFile('page.html', 'text/html', html.length)])

    const res = await download(request, ticket.id, reply.attachments[0].id)
    expect(res.headers()['content-type']).toBe('application/octet-stream')
    expect(res.headers()['content-disposition']).toMatch(/^attachment/)
    expect(res.headers()['x-content-type-options']).toBe('nosniff')
    expect(await res.body()).toEqual(html)
  })

  test('sender and authorId form fields are ignored: both come from the session', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'reply-files-spoof')
    await signInViaApi(request, ADMIN)
    const adminId = await currentUserId(request)
    await signInViaApi(request, AGENT)
    const agentId = await currentUserId(request)

    const reply = await postForm(
      request,
      ticket.id,
      replyForm({ body: 'Spoofed?', sender: 'customer', authorId: adminId }, [fileOfSize('note.txt', 1)]),
    )
    expect(reply).toMatchObject({ body: 'Spoofed?', sender: 'agent', author: { id: agentId, name: AGENT.name } })
    expect(reply.attachments).toHaveLength(1)

    expect(await listReplies(request, ticket.id)).toEqual([reply])
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

  // ai replies come only from the AI pipeline (needs OPENAI_API_KEY), so this one is written to the DB.
  test('an ai reply is returned with sender ai, the AI system agent as author, and bodyHTML, emailStatus and sentAt null, in order after an agent reply', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'reply-ai')
    await signInViaApi(request, AGENT)
    const agentReply = await postReply(request, ticket.id, 'Agent reply first')
    addAiReplyInDb(ticket.id, 'Answered from the knowledge base.')

    const replies = await listReplies(request, ticket.id)
    expect(replies).toEqual([
      agentReply,
      {
        id: expect.any(Number),
        body: 'Answered from the knowledge base.',
        bodyHTML: null,
        sender: 'ai',
        emailStatus: null,
        sentAt: null,
        createdAt: expect.any(String),
        author: { id: AI_AGENT.id, name: AI_AGENT.name },
        attachments: [],
      },
    ])
    expect(Number.isNaN(Date.parse(replies[1].createdAt))).toBe(false)
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

// POST /api/tickets/:id/replies/polish: validates like POST /replies, stores nothing. The test
// server has no OPENAI_API_KEY (server/.env.test doesn't set it), so every request
// that passes validation ends at 503 and OpenAI is never called.
test.describe('POST /api/tickets/:id/replies/polish', () => {
  const AI_OFF = { error: "AI isn't configured" }

  test('without a session gets 401 for an existing id and for abc, and stores nothing', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'polish-401')
    for (const id of [ticket.id, 'abc']) {
      const res = await request.post(`/api/tickets/${id}/replies/polish`, { data: { body: 'Polish me' } })
      expect(res.status(), `POST id ${id}`).toBe(401)
      expect(await res.json()).toEqual({ error: 'Unauthorized' })
    }

    await signInViaApi(request, AGENT)
    expect(await listReplies(request, ticket.id)).toEqual([])
  })

  for (const user of [AGENT, ADMIN] as Credentials[]) {
    test(`the ${user.name.toLowerCase()} gets 503 ${JSON.stringify(AI_OFF.error)} for a valid request, and no reply is stored`, async ({ request }) => {
      const ticket = await createTicketViaWebhook(request, `polish-503-${user.name.toLowerCase()}`)
      await signInViaApi(request, user)

      const res = await request.post(`/api/tickets/${ticket.id}/replies/polish`, { data: { body: 'thx we r on it' } })
      expect(res.status()).toBe(503)
      expect(await res.json()).toEqual(AI_OFF)

      expect(await listReplies(request, ticket.id)).toEqual([])
    })
  }

  test('leaves an existing thread unchanged', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'polish-thread')
    await signInViaApi(request, AGENT)
    const reply = await postReply(request, ticket.id, 'Already sent')

    const res = await request.post(`/api/tickets/${ticket.id}/replies/polish`, { data: { body: 'A new draft' } })
    expect(res.status()).toBe(503)

    expect(await listReplies(request, ticket.id)).toEqual([reply])
  })

  test('a body of exactly 10,000 characters passes validation (503, not 400)', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'polish-max')
    await signInViaApi(request, AGENT)

    const res = await request.post(`/api/tickets/${ticket.id}/replies/polish`, { data: { body: 'x'.repeat(10_000) } })
    expect(res.status()).toBe(503)
    expect(await res.json()).toEqual(AI_OFF)
  })

  const invalidBodies: [string, unknown, string][] = [
    ['an empty body', { body: '' }, EMPTY_ERROR],
    ['a whitespace-only body', { body: ' \n\t ' }, EMPTY_ERROR],
    ['a missing body', {}, EMPTY_ERROR],
    ['a 10,001-character body', { body: 'x'.repeat(10_001) }, TOO_LONG_ERROR],
  ]
  for (const [label, data, error] of invalidBodies) {
    test(`${label} gets 400 ${JSON.stringify(error)} and stores nothing`, async ({ request }) => {
      const ticket = await createTicketViaWebhook(request, 'polish-invalid')
      await signInViaApi(request, AGENT)

      const res = await request.post(`/api/tickets/${ticket.id}/replies/polish`, { data })
      expect(res.status()).toBe(400)
      expect(await res.json()).toEqual({ error })

      expect(await listReplies(request, ticket.id)).toEqual([])
    })
  }

  for (const id of ['abc', '0', '-1', '1.5', '2147483648']) {
    test(`id ${id} gets 400 ${JSON.stringify(TICKET_ID_ERROR)}`, async ({ request }) => {
      await signInViaApi(request, AGENT)
      const res = await request.post(`/api/tickets/${id}/replies/polish`, { data: { body: 'Hello' } })
      expect(res.status()).toBe(400)
      expect(await res.json()).toEqual({ error: TICKET_ID_ERROR })
    })
  }

  test('an invalid id with an empty body gets the id error (params are checked first)', async ({ request }) => {
    await signInViaApi(request, AGENT)
    const res = await request.post('/api/tickets/abc/replies/polish', { data: { body: '' } })
    expect(res.status()).toBe(400)
    expect(await res.json()).toEqual({ error: TICKET_ID_ERROR })
  })

  test(`a nonexistent id (${MISSING_ID}) with an empty body gets the body error (body before lookup)`, async ({ request }) => {
    await signInViaApi(request, AGENT)
    const res = await request.post(`/api/tickets/${MISSING_ID}/replies/polish`, { data: { body: '' } })
    expect(res.status()).toBe(400)
    expect(await res.json()).toEqual({ error: EMPTY_ERROR })
  })

  test(`a valid but nonexistent id (${MISSING_ID}) gets 404, not 503 (lookup before the AI check)`, async ({ request }) => {
    await signInViaApi(request, AGENT)
    const res = await request.post(`/api/tickets/${MISSING_ID}/replies/polish`, { data: { body: 'Hello' } })
    expect(res.status()).toBe(404)
    expect(await res.json()).toEqual({ error: 'Ticket not found' })
  })
})
