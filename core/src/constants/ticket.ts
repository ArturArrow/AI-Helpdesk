import type { Attachment } from "./attachment";
import type { TicketCategory } from "./ticketCategory";
import type { TicketStatus } from "./ticketStatus";

// A ticket as GET /api/tickets lists it; dates arrive as ISO strings.
export interface Ticket {
  id: number;
  subject: string;
  senderName: string;
  senderEmail: string;
  status: TicketStatus;
  category: TicketCategory | null;
  createdAt: string;
}

export interface Assignee {
  id: string;
  name: string;
}

// A ticket as GET /api/tickets/:id (and PATCH) returns it.
export interface TicketDetailData extends Ticket {
  body: string;
  // The sender's raw HTML, unsanitized; null for plain-text emails.
  bodyHTML: string | null;
  updatedAt: string;
  assignedTo: Assignee | null;
  // The files that came with the ticket's own email; a reply's come with the reply.
  attachments: Attachment[];
}

export interface TicketsOnDay {
  // YYYY-MM-DD in the requested time zone.
  date: string;
  count: number;
}

// GET /api/tickets/stats, for the dashboard. averageResolutionMs is null until a ticket is resolved.
// ticketsPerDay has every day of the period, oldest first, including days with no tickets; for
// all time it starts at the first ticket's day.
export interface TicketStats {
  total: number;
  open: number;
  resolvedByAi: number;
  averageResolutionMs: number | null;
  ticketsPerDay: TicketsOnDay[];
}
