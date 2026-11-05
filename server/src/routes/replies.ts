import { type NextFunction, type Request, type Response, Router } from "express";
import multer from "multer";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_REPLY_ATTACHMENT_BYTES,
  MAX_REPLY_ATTACHMENTS,
} from "core/constants/attachment";
import { createReplySchema } from "core/schemas/replies";
import {
  attachmentContentTypeSchema,
  attachmentFilenameSchema,
  ticketIdParamsSchema,
} from "core/schemas/tickets";
import { EmailStatus, ReplySender } from "../../generated/prisma/enums";
import { isAiConfigured, polishReply } from "../lib/ai";
import { attachmentSelect } from "../lib/attachments";
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
  attachments: { select: attachmentSelect, orderBy: { id: "asc" } },
} as const;

// The files of a reply, from a multipart form; any other request passes through untouched.
// defParamCharset: multer reads filenames as latin1 by default, which garbles non-ASCII ones.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: MAX_REPLY_ATTACHMENTS },
  defParamCharset: "utf8",
}).array("attachments");

// Upload errors have no status, so the error handler would answer them with a 500.
function uploadAttachments(req: Request, res: Response, next: NextFunction) {
  upload(req, res, (error: unknown) => {
    if (!error) return next();
    const tooLarge = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE";
    res.status(tooLarge ? 413 : 400).json({ error: error instanceof Error ? error.message : "Invalid upload" });
  });
}

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

// An agent's reply, written as the signed-in user, as JSON or as a multipart form with files in
// "attachments". With the mailer configured it's stored as pending and emailed to the customer by
// a background job (lib/sendReplyEmail.ts), so the response doesn't wait on SMTP.
repliesRouter.post("/", uploadAttachments, async (req, res) => {
  const params = validateParams(ticketIdParamsSchema, req, res);
  if (!params) return;
  const body = validate(createReplySchema, req, res);
  if (!body) return;

  const files = (req.files ?? []) as Express.Multer.File[];
  if (files.reduce((total, file) => total + file.size, 0) > MAX_REPLY_ATTACHMENT_BYTES) {
    res.status(413).json({ error: "Attachments are too large" });
    return;
  }

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
      attachments: {
        create: files.map((file) => ({
          ticketId: params.id,
          filename: attachmentFilenameSchema.parse(file.originalname),
          contentType: attachmentContentTypeSchema.parse(file.mimetype),
          size: file.size,
          data: Buffer.from(file.buffer),
        })),
      },
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
