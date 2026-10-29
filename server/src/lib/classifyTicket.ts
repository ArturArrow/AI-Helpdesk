import { classifyTicket } from "./ai";
import { prisma } from "./db";

// What the webhook queues for a new ticket: its id and the text the model classifies.
export type NewTicket = { id: number } & Parameters<typeof classifyTicket>[0];

// Sets a new ticket's category with AI, as the classify-ticket job (lib/queue.ts). A thrown error
// fails the job and pg-boss retries it. When the model can't tell what the ticket is about, it
// stays unclassified for an agent to set by hand.
export async function classifyNewTicket(ticket: NewTicket): Promise<void> {
  const category = await classifyTicket(ticket);
  if (!category) return;
  // Only while still unclassified, so a category an agent set in the meantime is kept.
  await prisma.ticket.updateMany({ where: { id: ticket.id, category: null }, data: { category } });
}
