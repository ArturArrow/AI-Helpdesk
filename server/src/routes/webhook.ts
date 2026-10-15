import { Router } from "express";
import { inboundEmailSchema } from "core/schemas/tickets";
import { Prisma } from "../../generated/prisma/client";
import { TicketStatus } from "../../generated/prisma/enums";
import { prisma } from "../lib/db";
import { validate } from "../lib/validate";

export const webhookRouter = Router();

function findByMessageId(messageId: string) {
  return prisma.ticket.findUnique({ where: { messageId }, select: { id: true } });
}

// Providers redeliver on timeouts, so a known messageId returns the existing ticket (200)
// instead of creating a duplicate.
webhookRouter.post("/inbound-email", async (req, res) => {
  const email = validate(inboundEmailSchema, req, res);
  if (!email) return;

  if (email.messageId) {
    const existing = await findByMessageId(email.messageId);
    if (existing) {
      res.json({ ticket: existing });
      return;
    }
  }

  try {
    const ticket = await prisma.ticket.create({
      data: { ...email, status: TicketStatus.open },
      select: { id: true },
    });
    res.status(201).json({ ticket });
  } catch (error) {
    // A concurrent redelivery won the race on the unique messageId.
    if (
      email.messageId &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      res.json({ ticket: await findByMessageId(email.messageId) });
      return;
    }
    throw error;
  }
});
