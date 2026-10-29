import { classifyTicket, isAiConfigured } from "./ai";
import { prisma } from "./db";

// Sets a new ticket's category with AI. Runs after the webhook has answered, so it never throws:
// on any failure the ticket just stays unclassified, for an agent to set by hand.
export async function classifyNewTicket(id: number): Promise<void> {
  if (!isAiConfigured) return;
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      select: { subject: true, body: true, senderName: true },
    });
    if (!ticket) return;
    const category = await classifyTicket(ticket);
    // Only while still unclassified, so a category an agent set in the meantime is kept.
    await prisma.ticket.updateMany({ where: { id, category: null }, data: { category } });
  } catch (error) {
    console.error(`[ai] couldn't classify ticket ${id}:`, error);
  }
}
