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
  updatedAt: string;
  assignedTo: Assignee | null;
}
