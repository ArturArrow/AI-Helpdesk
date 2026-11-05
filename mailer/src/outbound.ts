import { timingSafeEqual } from "node:crypto";
import { sendEmailSchema } from "core/schemas/email";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import nodemailer from "nodemailer";
import { MAIL_FROM, MAILER_SECRET, SMTP } from "./env";

export const transporter = nodemailer.createTransport({
  host: SMTP.host,
  port: SMTP.port,
  secure: SMTP.secure,
  auth: { user: SMTP.user, pass: SMTP.password },
});

const expected = Buffer.from(MAILER_SECRET);

// timingSafeEqual throws on unequal lengths, hence the length check.
function requireMailerSecret(req: Request, res: Response, next: NextFunction) {
  const given = Buffer.from(req.get("x-mailer-secret") ?? "");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

export const sendRouter = Router();

// The body parser runs after the secret check, so an unknown caller can't make it read that much.
// 26 MB holds MAX_REPLY_ATTACHMENT_BYTES as base64, plus the text.
sendRouter.post("/send", requireMailerSecret, express.json({ limit: "26mb" }), async (req, res) => {
  const parsed = sendEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]!.message });
    return;
  }

  const { attachments, ...email } = parsed.data;
  try {
    const info = await transporter.sendMail({
      from: MAIL_FROM,
      ...email,
      // The schema keeps only these fields, so a caller can't reach nodemailer's path or href.
      ...(attachments && { attachments: attachments.map((file) => ({ ...file, encoding: "base64" })) }),
    });
    // The server stores this to thread the customer's answer back onto the ticket.
    res.json({ messageId: info.messageId });
  } catch (error) {
    console.error("[outbound] SMTP send failed:", error);
    res.status(502).json({ error: "Couldn't send the email" });
  }
});
