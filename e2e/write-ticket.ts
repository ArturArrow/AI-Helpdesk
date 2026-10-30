// Run by setTicketStatusInDb / addAiReplyInDb (fixtures/tickets.ts) from server/ with only
// .env.test loaded. Writes ticket states no endpoint can produce in the test env: the `new` and
// `processing` statuses (set only by the AI pipeline, which needs OPENAI_API_KEY) and `ai` replies.
//
// Imported by a non-literal path for the same reason as seed-agent.ts: the root tsconfig
// shouldn't type-check server/.
const dbPath = '../server/src/lib/db.ts'

// Same guard as scripts/assert-test-db.ts: never write outside a *_test database.
const url = process.env.DATABASE_URL
const database = url ? new URL(url).pathname.slice(1) : ''
if (!database.endsWith('_test')) {
  console.error(`write-ticket: refusing to write to "${database || '(unset)'}": DATABASE_URL must point at a *_test database.`)
  process.exit(1)
}

const { E2E_TICKET_ID: ticketId, E2E_TICKET_STATUS: status, E2E_AI_REPLY_BODY: aiReplyBody } = process.env
if (!ticketId || (!status && !aiReplyBody)) {
  console.error('write-ticket: E2E_TICKET_ID and one of E2E_TICKET_STATUS or E2E_AI_REPLY_BODY must be set')
  process.exit(1)
}

const { prisma } = await import(dbPath)
const id = Number(ticketId)
if (status) await prisma.ticket.update({ where: { id }, data: { status } })
if (aiReplyBody) await prisma.reply.create({ data: { ticketId: id, body: aiReplyBody, sender: 'ai' } })
await prisma.$disconnect()
