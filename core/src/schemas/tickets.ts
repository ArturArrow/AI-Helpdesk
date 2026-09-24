import { z } from "zod";

// Body of POST /api/webhooks/inbound-email. Provider-neutral: a SendGrid/Mailgun adapter
// (or a forwarding script) maps its own format onto this.
export const inboundEmailSchema = z.object({
  senderEmail: z
    .string({ error: "senderEmail is required" })
    .trim()
    .toLowerCase()
    .pipe(z.email("senderEmail must be a valid email address")),
  senderName: z.string({ error: "senderName is required" }).trim().min(1, "senderName is required"),
  // 998 is the RFC 5322 line-length limit for a header.
  subject: z
    .string()
    .trim()
    .max(998, "subject is too long")
    .optional()
    .transform((subject) => subject || "(no subject)"),
  body: z.string({ error: "body is required" }).trim().min(1, "body is required"),
  bodyHTML: z.string().optional(),
  messageId: z.string().trim().min(1).optional(),
});

export type InboundEmailInput = z.input<typeof inboundEmailSchema>;
