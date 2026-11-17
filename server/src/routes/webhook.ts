import * as Sentry from "@sentry/bun";
import { Router } from "express";
import { inboundEmailSchema } from "core/schemas/tickets";
import { Prisma } from "../../generated/prisma/client";
import { ReplySender, TicketStatus } from "../../generated/prisma/enums";
import { isAiConfigured } from "../lib/ai";
import { prisma } from "../lib/db";
import { AI_AGENT_ID } from "../lib/aiAgent";
import { toAttachmentRows } from "../lib/attachments";
import { isAutoResolveConfigured, openForAgent } from "../lib/autoResolveTicket";
import { AUTO_RESOLVE_TICKET_QUEUE, boss, CLASSIFY_TICKET_QUEUE } from "../lib/queue";
import { validate } from "../lib/validate";

export const webhookRouter = Router();

// The ticket or customer reply already stored for a messageId, in the shape the webhook returns.
async function findByMessageId(messageId: string) {
  const ticket = await prisma.ticket.findUnique({ where: { messageId }, select: { id: true } });
  if (ticket) return { ticket };

  const reply = await prisma.reply.findUnique({
    where: { messageId },
    select: { id: true, ticketId: true },
  });
  if (reply) return { ticket: { id: reply.ticketId }, reply: { id: reply.id } };

  return null;
}

// The ticket whose thread an email answers: one whose own email, or one of whose customer
// replies, is named in In-Reply-To or References. The sender isn't checked against the
// ticket's, since anyone on CC may answer the thread.
function findThreadTicket(messageIds: string[]) {
  if (messageIds.length === 0) return null;
  return prisma.ticket.findFirst({
    where: {
      OR: [
        { messageId: { in: messageIds } },
        { replies: { some: { messageId: { in: messageIds } } } },
      ],
    },
    select: { id: true, status: true },
  });
}

// Providers redeliver on timeouts, so a known messageId returns the existing ticket or reply
// (200) instead of creating a duplicate. An email in a known thread becomes a customer reply
// on that ticket and reopens it; anything else becomes a new ticket.
webhookRouter.post("/inbound-email", async (req, res) => {
  const email = validate(inboundEmailSchema, req, res);
  if (!email) return;
  const { inReplyTo, references = [], attachments = [], ...fields } = email;
  const attachmentRows = toAttachmentRows(attachments);

  if (fields.messageId) {
    const existing = await findByMessageId(fields.messageId);
    if (existing) {
      res.json(existing);
      return;
    }
  }

  try {
    const thread = await findThreadTicket(inReplyTo ? [inReplyTo, ...references] : references);
    if (thread) {
      const [reply] = await prisma.$transaction([
        prisma.reply.create({
          data: {
            ticketId: thread.id,
            body: fields.body,
            bodyHTML: fields.bodyHTML,
            messageId: fields.messageId,
            sender: ReplySender.customer,
            attachments: { create: attachmentRows.map((row) => ({ ...row, ticketId: thread.id })) },
          },
          select: { id: true },
        }),
        ...(thread.status === TicketStatus.open
          ? []
          : [prisma.ticket.update({ where: { id: thread.id }, data: { status: TicketStatus.open, resolvedAt: null } })]),
        // The customer wrote back, so a person takes over from the AI.
        prisma.ticket.updateMany({ where: { id: thread.id, assignedToId: AI_AGENT_ID }, data: { assignedToId: null } }),
      ]);
      res.status(201).json({ ticket: { id: thread.id }, reply });
      return;
    }

    // With auto-resolving, a ticket starts as new (hidden from the list) until the AI resolves it or
    // opens it for an agent; without it, it's open straight away.
    const ticket = await prisma.ticket.create({
      // The AI agent holds it while it tries to answer; openForAgent unassigns it if it can't.
      data: {
        ...fields,
        attachments: { create: attachmentRows },
        ...(isAutoResolveConfigured
          ? { status: TicketStatus.new, assignedToId: AI_AGENT_ID }
          : { status: TicketStatus.open }),
      },
      // The stored subject, body and sender go straight to classification, without a second read.
      select: { id: true, subject: true, body: true, senderName: true },
    });
    // Classified and auto-resolved by background jobs: the provider shouldn't wait on the model, or
    // it may time out and redeliver. The ticket is already stored, so a queue failure only leaves it
    // unclassified, or opens it for an agent.
    // The AI can't read the files, but it has to know they're there.
    const job = { ...ticket, attachments: attachmentRows.map((row) => row.filename) };
    if (isAiConfigured) {
      try {
        await boss.send(CLASSIFY_TICKET_QUEUE, job);
      } catch (error) {
        console.error(`[queue] couldn't queue classification of ticket ${ticket.id}:`, error);
        Sentry.captureException(error);
      }
    }
    if (isAutoResolveConfigured) {
      try {
        await boss.send(AUTO_RESOLVE_TICKET_QUEUE, job);
      } catch (error) {
        console.error(`[queue] couldn't queue auto-resolving ticket ${ticket.id}:`, error);
        Sentry.captureException(error);
        await openForAgent(ticket.id);
      }
    }
    res.status(201).json({ ticket: { id: ticket.id } });
  } catch (error) {
    // A concurrent redelivery won the race on the unique messageId.
    if (
      fields.messageId &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      res.json(await findByMessageId(fields.messageId));
      return;
    }
    throw error;
  }
});
