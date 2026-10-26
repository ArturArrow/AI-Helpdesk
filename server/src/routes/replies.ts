import { Router } from "express";
import { createReplySchema } from "core/schemas/replies";
import { ticketIdParamsSchema } from "core/schemas/tickets";
import { ReplySender } from "../../generated/prisma/enums";
import { isAiConfigured, MAX_CONTEXT_REPLIES, polishReply } from "../lib/ai";
import { prisma } from "../lib/db";
import { validate, validateParams } from "../lib/validate";

// Mounted by ticketsRouter on /:id/replies; mergeParams exposes that :id here.
export const repliesRouter = Router({ mergeParams: true });

// author is null for ReplySender.customer. bodyHTML is the sender's raw, unsanitized HTML.
const replySelect = {
  id: true,
  body: true,
  bodyHTML: true,
  sender: true,
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

// An agent's reply, written as the signed-in user. Only stored for now: there is no email
// provider yet to send it to the customer.
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
    data: { ticketId: params.id, body: body.body, sender: ReplySender.agent, authorId: req.user!.id },
    select: replySelect,
  });
  res.status(201).json({ reply });
});

// The agent's draft polished by AI, for the agent to review before sending. The ticket and its
// thread (plain-text bodies, never bodyHTML) go along as context. Nothing is stored.
repliesRouter.post("/polish", async (req, res) => {
  const params = validateParams(ticketIdParamsSchema, req, res);
  if (!params) return;
  const body = validate(createReplySchema, req, res);
  if (!body) return;

  const ticket = await prisma.ticket.findUnique({
    where: { id: params.id },
    select: {
      subject: true,
      body: true,
      senderName: true,
      // The latest replies, newest first; reversed below to read oldest first.
      replies: {
        select: { body: true, sender: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: MAX_CONTEXT_REPLIES,
      },
    },
  });
  if (!ticket) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }
  if (!isAiConfigured) {
    res.status(503).json({ error: "AI isn't configured" });
    return;
  }
  // requireAuth (mounted on /api/tickets) has set req.user; the reply is signed with their name.
  const context = { ...ticket, replies: ticket.replies.reverse() };
  res.json({ body: await polishReply(body.body, context, req.user!.name) });
});
