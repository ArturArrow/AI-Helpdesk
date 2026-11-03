// Run by the DB helpers in fixtures/tickets.ts from server/ with only .env.test loaded. Writes
// ticket states no endpoint can produce in the test env: the `new` and `processing` statuses (set
// only by the AI pipeline, which needs OPENAI_API_KEY), `ai` replies, chosen createdAt/resolvedAt
// values (resolvedAt isn't in any response), tickets held by the AI system agent (assigned only by
// the AI pipeline; PATCH refuses it), and an empty ticket table for the global stats.
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

const {
  E2E_DELETE_ALL_TICKETS: deleteAll,
  E2E_TICKET_ID: ticketId,
  E2E_TICKET_STATUS: status,
  E2E_TICKET_CREATED_AT: createdAt,
  E2E_TICKET_RESOLVED_AT: resolvedAt,
  E2E_TICKET_ASSIGNED_TO_ID: assignedToId,
  E2E_AI_REPLY_BODY: aiReplyBody,
} = process.env
const hasTicketWrite = Boolean(status || createdAt || resolvedAt || assignedToId || aiReplyBody)
if (!deleteAll && !(ticketId && hasTicketWrite)) {
  console.error(
    'write-ticket: set E2E_DELETE_ALL_TICKETS, or E2E_TICKET_ID with one of E2E_TICKET_STATUS, ' +
      'E2E_TICKET_CREATED_AT, E2E_TICKET_RESOLVED_AT, E2E_TICKET_ASSIGNED_TO_ID or E2E_AI_REPLY_BODY',
  )
  process.exit(1)
}

const { prisma } = await import(dbPath)
// Replies go with their tickets (onDelete: Cascade).
if (deleteAll) await prisma.ticket.deleteMany()
if (ticketId) {
  const id = Number(ticketId)
  const data: Record<string, unknown> = {}
  if (status) data.status = status
  if (createdAt) data.createdAt = new Date(createdAt)
  // 'null' clears the column.
  if (resolvedAt) data.resolvedAt = resolvedAt === 'null' ? null : new Date(resolvedAt)
  if (assignedToId) data.assignedToId = assignedToId === 'null' ? null : assignedToId
  if (Object.keys(data).length > 0) await prisma.ticket.update({ where: { id }, data })
  // Authored by the AI system agent (migrations/20261103120000_add_ai_agent), as the pipeline does.
  if (aiReplyBody) {
    await prisma.reply.create({ data: { ticketId: id, body: aiReplyBody, sender: 'ai', authorId: 'ai-agent' } })
  }
}
await prisma.$disconnect()
