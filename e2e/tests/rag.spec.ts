import { expect, test, type APIRequestContext } from '@playwright/test'
import { ADMIN, AGENT, signInViaApi } from '../fixtures/auth.js'

// The /api/rag guards, at the API level. The router proxies a separate rag service, and
// server/.env.test sets neither RAG_URL nor RAG_SECRET, so a request that passes requireAuth and
// requireAdmin gets the router's own 503. That 503 is what proves the admin got through both
// guards; the proxying itself is covered by server unit tests (server/src/lib/rag.test.ts).
// Each test gets a fresh `request` context with its own cookie jar.

const NOT_CONFIGURED = { error: "The document service isn't configured" }

// Any well-formed UUID: the request never reaches the service, so the document needn't exist.
const DOCUMENT_ID = '3f2c8a1e-5b7d-4c9a-8e6f-1a2b3c4d5e6f'

const endpoints: [string, (request: APIRequestContext) => ReturnType<APIRequestContext['get']>][] = [
  ['GET /api/rag/documents', (request) => request.get('/api/rag/documents')],
  [
    'POST /api/rag/documents',
    (request) =>
      request.post('/api/rag/documents', {
        multipart: {
          file: { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Refunds take 5 days.\n') },
        },
      }),
  ],
  ['GET /api/rag/documents/:id/file', (request) => request.get(`/api/rag/documents/${DOCUMENT_ID}/file`)],
  ['DELETE /api/rag/documents/:id', (request) => request.delete(`/api/rag/documents/${DOCUMENT_ID}`)],
]

for (const [name, call] of endpoints) {
  test.describe(name, () => {
    test('401 without a session', async ({ request }) => {
      const res = await call(request)
      expect(res.status()).toBe(401)
      expect(await res.json()).toEqual({ error: 'Unauthorized' })
    })

    test('403 for the agent', async ({ request }) => {
      await signInViaApi(request, AGENT)
      const res = await call(request)
      expect(res.status()).toBe(403)
      expect(await res.json()).toEqual({ error: 'Forbidden' })
    })

    test('503 for the admin: past both guards, the service is not configured', async ({ request }) => {
      await signInViaApi(request, ADMIN)
      const res = await call(request)
      expect(res.status()).toBe(503)
      expect(await res.json()).toEqual(NOT_CONFIGURED)
    })
  })
}
