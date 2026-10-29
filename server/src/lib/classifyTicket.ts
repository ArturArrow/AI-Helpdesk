import { classifyTicket, isAiConfigured } from "./ai";
import { prisma } from "./db";

// Sets a new ticket's category with AI. Runs after the webhook has answered, so it never throws:
// on any failure, or when the model can't tell what the ticket is about, the ticket stays
// unclassified for an agent to set by hand.
export async function classifyNewTicket(
  ticket: { id: number } & Parameters<typeof classifyTicket>[0],
): Promise<void> {
  if (!isAiConfigured) return;
  try {
    const category = await classifyTicket(ticket);
    if (!category) return;
    // Only while still unclassified, so a category an agent set in the meantime is kept.
    await prisma.ticket.updateMany({ where: { id: ticket.id, category: null }, data: { category } });
  } catch (error) {
    console.error(`[ai] couldn't classify ticket ${ticket.id}:`, error);
  }
}
