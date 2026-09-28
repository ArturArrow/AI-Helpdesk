// Run by assignTicketInDb (fixtures/tickets.ts) from server/ with only .env.test loaded. Sets a
// ticket's assignedToId directly through Prisma, since no endpoint assigns tickets yet.
//
// Imported by a non-literal path for the same reason as seed-agent.ts: the root tsconfig
// shouldn't type-check server/.
const dbPath = '../server/src/lib/db.ts'

// Same guard as scripts/assert-test-db.ts: never write outside a *_test database.
const url = process.env.DATABASE_URL
const database = url ? new URL(url).pathname.slice(1) : ''
if (!database.endsWith('_test')) {
  console.error(`assign-ticket: refusing to write to "${database || '(unset)'}": DATABASE_URL must point at a *_test database.`)
  process.exit(1)
}

const { E2E_TICKET_ID: ticketId, E2E_ASSIGNEE_ID: assigneeId } = process.env
if (!ticketId || !assigneeId) {
  console.error('assign-ticket: E2E_TICKET_ID and E2E_ASSIGNEE_ID must be set')
  process.exit(1)
}

const { prisma } = await import(dbPath)
await prisma.ticket.update({ where: { id: Number(ticketId) }, data: { assignedToId: assigneeId } })
await prisma.$disconnect()
