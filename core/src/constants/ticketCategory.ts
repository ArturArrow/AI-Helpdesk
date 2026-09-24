// Mirrors `enum TicketCategory` in server/prisma/schema.prisma (checked by
// server/src/lib/enumsInSync.ts).
export enum TicketCategory {
  general_question = "general_question",
  technical_question = "technical_question",
  refund_request = "refund_request",
}
