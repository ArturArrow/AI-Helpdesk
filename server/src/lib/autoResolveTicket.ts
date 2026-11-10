import { EmailStatus, ReplySender, TicketStatus } from "../../generated/prisma/enums";
import { autoResolveTicket, isAiConfigured } from "./ai";
import { AI_AGENT_ID } from "./aiAgent";
import type { NewTicket } from "./classifyTicket";
import { prisma } from "./db";
import { isMailerConfigured, isRagConfigured } from "./env";
import { searchKnowledge } from "./rag";

// Auto-resolving needs the model and the knowledge base. Without either, new tickets go straight to
// the agents (classification needs only the model).
export const isAutoResolveConfigured = isAiConfigured && isRagConfigured;

// Statuses the AI may still move a ticket out of: anything else means an agent already changed it.
const AI_STATUSES = [TicketStatus.new, TicketStatus.processing];

// Tries to resolve a new ticket from the knowledge base (the rag service), as the auto-resolve-ticket job
// (lib/queue.ts). The ticket is assigned to the AI agent from the webhook and processing while the
// model works, then resolved with an AI reply (still assigned to the AI), or open and unassigned
// for an agent. Returns the id of the AI reply, for queue.ts to email; null when nothing was
// answered. A thrown error fails the job and pg-boss retries it; on the last attempt
// the ticket is opened first, so it's never left hidden from the list.
export async function autoResolveNewTicket(ticket: NewTicket, lastAttempt: boolean): Promise<number | null> {
  const { count } = await prisma.ticket.updateMany({
    where: { id: ticket.id, status: { in: AI_STATUSES } },
    data: { status: TicketStatus.processing },
  });
  if (count === 0) return null;

  try {
    // Nothing close enough in the knowledge base: no use asking the model.
    const knowledge = await searchKnowledge(`${ticket.subject}\n\n${ticket.body}`);
    const { resolved, reply } = knowledge ? await autoResolveTicket(ticket, knowledge) : { resolved: false, reply: "" };
    // Only while still processing, so a status an agent set in the meantime is kept.
    const stillProcessing = { id: ticket.id, status: TicketStatus.processing };
    if (!resolved) {
      await openForAgent(ticket.id, [TicketStatus.processing]);
      return null;
    }
    return await prisma.$transaction(async (tx) => {
      const { count } = await tx.ticket.updateMany({ where: stillProcessing, data: { status: TicketStatus.resolved, resolvedAt: new Date() } });
      if (count === 0) return null;
      const created = await tx.reply.create({
        data: {
          ticketId: ticket.id,
          body: reply,
          sender: ReplySender.ai,
          authorId: AI_AGENT_ID,
          emailStatus: isMailerConfigured ? EmailStatus.pending : null,
        },
        select: { id: true },
      });
      return created.id;
    });
  } catch (error) {
    if (lastAttempt) await openForAgent(ticket.id);
    throw error;
  }
}

// Hands a ticket the AI couldn't answer to the agents: open, and unassigned if the AI still holds
// it (an agent assigned in the meantime is kept). Only from `statuses`, so a status an agent set wins.
export async function openForAgent(id: number, statuses: TicketStatus[] = AI_STATUSES): Promise<void> {
  const where = { id, status: { in: statuses } };
  await prisma.$transaction([
    prisma.ticket.updateMany({ where: { ...where, assignedToId: AI_AGENT_ID }, data: { status: TicketStatus.open, assignedToId: null } }),
    prisma.ticket.updateMany({ where, data: { status: TicketStatus.open } }),
  ]);
}
