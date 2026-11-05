import type { SendEmailInput } from "core/schemas/email";
import { EmailStatus } from "../../generated/prisma/enums";
import { prisma } from "./db";
import { MAILER_SECRET, MAILER_URL } from "./env";

// The mailer's (and RFC 5322's practical) cap on References entries.
const MAX_REFERENCES = 100;

// Threading headers for a reply on a ticket: References lists the thread's Message-IDs oldest
// first (the customer's first email, then every email since), In-Reply-To the latest. Past the
// cap the first one is kept, since it identifies the thread, plus the most recent.
export function threadHeaders(
  ticketMessageId: string | null,
  earlierMessageIds: string[],
): Pick<SendEmailInput, "inReplyTo" | "references"> {
  const all = [...(ticketMessageId ? [ticketMessageId] : []), ...earlierMessageIds];
  if (all.length === 0) return {};
  const references = all.length > MAX_REFERENCES ? [all[0]!, ...all.slice(-(MAX_REFERENCES - 1))] : all;
  return { inReplyTo: all.at(-1), references };
}

export function replySubject(subject: string) {
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
}

// Also used for a reply whose email job couldn't be queued.
export function markReplyEmailFailed(id: number) {
  return prisma.reply.updateMany({
    where: { id, emailStatus: EmailStatus.pending },
    data: { emailStatus: EmailStatus.failed },
  });
}

export type ReplyEmailJob = { replyId: number };

// Emails an agent or AI reply to the ticket's sender through the mailer, as the
// send-reply-email job (lib/queue.ts). Only a pending reply is sent, so a retry after success
// doesn't send it again. One gap remains: if the mailer sent it but storing the result fails,
// the retry sends it a second time. A 400 from the mailer can't succeed later, so the reply is
// marked failed at once; any other error fails the job for pg-boss to retry, and on the last
// attempt the reply is marked failed first.
export async function sendReplyEmail({ replyId }: ReplyEmailJob, lastAttempt: boolean): Promise<void> {
  const reply = await prisma.reply.findUnique({
    where: { id: replyId },
    select: {
      body: true,
      emailStatus: true,
      createdAt: true,
      attachments: { select: { filename: true, contentType: true, data: true }, orderBy: { id: "asc" } },
      ticket: { select: { id: true, subject: true, senderEmail: true, messageId: true } },
    },
  });
  if (!reply || reply.emailStatus !== EmailStatus.pending) return;

  try {
    // Every email in the thread so far: the customer's replies and the replies already sent.
    const earlier = await prisma.reply.findMany({
      where: { ticketId: reply.ticket.id, id: { not: replyId }, createdAt: { lte: reply.createdAt }, messageId: { not: null } },
      select: { messageId: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const email: SendEmailInput = {
      to: reply.ticket.senderEmail,
      subject: replySubject(reply.ticket.subject),
      text: reply.body,
      // Only replies written here are emailed, and their files are always stored, so data is set.
      ...(reply.attachments.length > 0 && {
        attachments: reply.attachments.map(({ filename, contentType, data }) => ({
          filename,
          contentType,
          content: Buffer.from(data!).toString("base64"),
        })),
      }),
      ...threadHeaders(reply.ticket.messageId, earlier.map((r) => r.messageId!)),
    };

    const res = await fetch(`${MAILER_URL}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Mailer-Secret": MAILER_SECRET! },
      body: JSON.stringify(email),
    });
    if (res.status === 400) {
      console.error(`[mail] mailer rejected reply ${replyId}: ${await res.text()}`);
      await markReplyEmailFailed(replyId);
      return;
    }
    if (!res.ok) throw new Error(`mailer answered ${res.status}: ${await res.text()}`);

    const { messageId } = (await res.json()) as { messageId: string };
    await prisma.reply.update({
      where: { id: replyId },
      data: { emailStatus: EmailStatus.sent, sentAt: new Date(), messageId },
    });
  } catch (error) {
    if (lastAttempt) await markReplyEmailFailed(replyId);
    throw error;
  }
}
