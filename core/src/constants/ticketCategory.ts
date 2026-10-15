// Mirrors `enum TicketCategory` in server/prisma/schema.prisma (checked by
// server/src/lib/enumsInSync.ts).
export enum TicketCategory {
  general_question = "general_question",
  technical_question = "technical_question",
  refund_request = "refund_request",
}

export const categoryLabels: Record<TicketCategory, string> = {
  [TicketCategory.general_question]: "General question",
  [TicketCategory.technical_question]: "Technical question",
  [TicketCategory.refund_request]: "Refund request",
};
