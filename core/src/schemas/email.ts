import { z } from "zod";
import { MAX_REPLY_ATTACHMENTS } from "../constants/attachment";

const messageId = z.string().trim().min(1).max(998, "Message-ID is too long");

// Body of the mailer's POST /send. inReplyTo and references thread the email onto the
// customer's conversation; the From is the mailer's own MAIL_FROM.
export const sendEmailSchema = z.object({
  to: z
    .string({ error: "to is required" })
    .trim()
    .max(254, "to is too long")
    .pipe(z.email("to must be a valid email address")),
  subject: z.string({ error: "subject is required" }).trim().min(1, "subject is required").max(998, "subject is too long"),
  text: z.string({ error: "text is required" }).trim().min(1, "text is required").max(50_000, "text is too long"),
  html: z.string().max(100_000, "html is too long").optional(),
  inReplyTo: messageId.optional(),
  references: z
    .array(messageId, { error: "references must be an array of Message-IDs" })
    .max(100, "references has too many entries")
    .optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string().min(1).max(255, "attachment filename is too long"),
        contentType: z.string().min(1).max(255, "attachment contentType is too long"),
        content: z.base64("attachment content must be base64"),
      }),
      { error: "attachments must be an array" },
    )
    .max(MAX_REPLY_ATTACHMENTS, "attachments has too many entries")
    .optional(),
});

export type SendEmailInput = z.infer<typeof sendEmailSchema>;
