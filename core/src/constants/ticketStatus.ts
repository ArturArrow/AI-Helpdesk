// Mirrors `enum TicketStatus` in server/prisma/schema.prisma (checked by
// server/src/lib/enumsInSync.ts).
export enum TicketStatus {
  open = "open",
  resolved = "resolved",
  closed = "closed",
}
