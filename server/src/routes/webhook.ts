import { Router } from "express";
import { inboundEmailSchema } from "core/schemas/tickets";
import { Prisma } from "../../generated/prisma/client";
import { ReplySender, TicketStatus } from "../../generated/prisma/enums";
import { prisma } from "../lib/db";
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
  const { inReplyTo, references = [], ...fields } = email;

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
          },
          select: { id: true },
        }),
        ...(thread.status === TicketStatus.open
          ? []
          : [prisma.ticket.update({ where: { id: thread.id }, data: { status: TicketStatus.open } })]),
      ]);
      res.status(201).json({ ticket: { id: thread.id }, reply });
      return;
    }

    const ticket = await prisma.ticket.create({
      data: { ...fields, status: TicketStatus.open },
      select: { id: true },
    });
    res.status(201).json({ ticket });
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
