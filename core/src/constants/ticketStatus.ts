// Mirrors `enum TicketStatus` in server/prisma/schema.prisma (checked by
// server/src/lib/enumsInSync.ts).
export enum TicketStatus {
  new = "new",
  processing = "processing",
  open = "open",
  resolved = "resolved",
  closed = "closed",
}

export const statusLabels: Record<TicketStatus, string> = {
  [TicketStatus.new]: "New",
  [TicketStatus.processing]: "Processing",
  [TicketStatus.open]: "Open",
  [TicketStatus.resolved]: "Resolved",
  [TicketStatus.closed]: "Closed",
};

// The statuses agents list, filter by and set. new and processing belong to the AI, which is
// still trying to resolve the ticket, so those tickets stay out of the list.
export const VISIBLE_TICKET_STATUSES = [TicketStatus.open, TicketStatus.resolved, TicketStatus.closed] as const;

export type VisibleTicketStatus = (typeof VISIBLE_TICKET_STATUSES)[number];

export function isVisibleStatus(status: TicketStatus): status is VisibleTicketStatus {
  return (VISIBLE_TICKET_STATUSES as readonly TicketStatus[]).includes(status);
}
