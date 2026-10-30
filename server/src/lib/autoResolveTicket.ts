import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ReplySender, TicketStatus } from "../../generated/prisma/enums";
import { autoResolveTicket } from "./ai";
import type { NewTicket } from "./classifyTicket";
import { prisma } from "./db";

// Read on every job, so an edit takes effect without a restart.
const KNOWLEDGE_BASE_PATH = join(import.meta.dirname, "../../knowledge-base/knowledge-base.md");

// Statuses the AI may still move a ticket out of: anything else means an agent already changed it.
const AI_STATUSES = [TicketStatus.new, TicketStatus.processing];

// Tries to resolve a new ticket from the knowledge base, as the auto-resolve-ticket job
// (lib/queue.ts). The ticket is processing while the model works, then resolved with an AI reply,
// or open for an agent. A thrown error fails the job and pg-boss retries it; on the last attempt
// the ticket is opened first, so it's never left hidden from the list.
export async function autoResolveNewTicket(ticket: NewTicket, lastAttempt: boolean): Promise<void> {
  const { count } = await prisma.ticket.updateMany({
    where: { id: ticket.id, status: { in: AI_STATUSES } },
    data: { status: TicketStatus.processing },
  });
  if (count === 0) return;

  try {
    const { resolved, reply } = await autoResolveTicket(ticket, await readFile(KNOWLEDGE_BASE_PATH, "utf8"));
    // Only while still processing, so a status an agent set in the meantime is kept.
    const stillProcessing = { id: ticket.id, status: TicketStatus.processing };
    if (!resolved) {
      await prisma.ticket.updateMany({ where: stillProcessing, data: { status: TicketStatus.open } });
      return;
    }
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.ticket.updateMany({ where: stillProcessing, data: { status: TicketStatus.resolved, resolvedAt: new Date() } });
      if (count === 0) return;
      await tx.reply.create({ data: { ticketId: ticket.id, body: reply, sender: ReplySender.ai } });
    });
  } catch (error) {
    if (lastAttempt) await openForAgent(ticket.id);
    throw error;
  }
}

// Hands a ticket the AI couldn't process to the agents.
export async function openForAgent(id: number): Promise<void> {
  await prisma.ticket.updateMany({
    where: { id, status: { in: AI_STATUSES } },
    data: { status: TicketStatus.open },
  });
}
