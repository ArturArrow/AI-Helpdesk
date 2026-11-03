import { Router } from "express";
import { createReplySchema } from "core/schemas/replies";
import { ticketIdParamsSchema } from "core/schemas/tickets";
import { EmailStatus, ReplySender } from "../../generated/prisma/enums";
import { isAiConfigured, polishReply } from "../lib/ai";
import { prisma } from "../lib/db";
import { isMailerConfigured } from "../lib/env";
import { queueReplyEmail } from "../lib/queue";
import { loadTicketContext } from "../lib/ticketContext";
import { validate, validateParams } from "../lib/validate";

// Mounted by ticketsRouter on /:id/replies; mergeParams exposes that :id here.
export const repliesRouter = Router({ mergeParams: true });

// author is null for ReplySender.customer. bodyHTML is the sender's raw, unsanitized HTML.
// emailStatus is null for customer replies and for replies stored without the mailer.
const replySelect = {
  id: true,
  body: true,
  bodyHTML: true,
  sender: true,
  emailStatus: true,
  sentAt: true,
  createdAt: true,
  author: { select: { id: true, name: true } },
} as const;

function ticketExists(id: number) {
  return prisma.ticket.findUnique({ where: { id }, select: { id: true } });
}

// The ticket's thread, oldest first.
repliesRouter.get("/", async (req, res) => {
  const params = validateParams(ticketIdParamsSchema, req, res);
  if (!params) return;

  if (!(await ticketExists(params.id))) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }
  const replies = await prisma.reply.findMany({
    where: { ticketId: params.id },
    select: replySelect,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  res.json({ replies });
});

// An agent's reply, written as the signed-in user. With the mailer configured it's stored as
// pending and emailed to the customer by a background job (lib/sendReplyEmail.ts), so the
// response doesn't wait on SMTP.
repliesRouter.post("/", async (req, res) => {
  const params = validateParams(ticketIdParamsSchema, req, res);
  if (!params) return;
  const body = validate(createReplySchema, req, res);
  if (!body) return;

  if (!(await ticketExists(params.id))) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }
  const reply = await prisma.reply.create({
    // requireAuth (mounted on /api/tickets) has set req.user.
    data: {
      ticketId: params.id,
      body: body.body,
      sender: ReplySender.agent,
      authorId: req.user!.id,
      emailStatus: isMailerConfigured ? EmailStatus.pending : null,
    },
    select: replySelect,
  });
  await queueReplyEmail(reply.id);
  res.status(201).json({ reply });
});

// The agent's draft polished by AI, for the agent to review before sending. The ticket and its
// thread (plain-text bodies, never bodyHTML) go along as context. Nothing is stored.
repliesRouter.post("/polish", async (req, res) => {
  const params = validateParams(ticketIdParamsSchema, req, res);
  if (!params) return;
  const body = validate(createReplySchema, req, res);
  if (!body) return;

  const ticket = await loadTicketContext(params.id);
  if (!ticket) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }
  if (!isAiConfigured) {
    res.status(503).json({ error: "AI isn't configured" });
    return;
  }
  // requireAuth (mounted on /api/tickets) has set req.user; the reply is signed with their name.
  res.json({ body: await polishReply(body.body, ticket, req.user!.name) });
});
