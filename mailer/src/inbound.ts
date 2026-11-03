import type { InboundEmailInput } from "core/schemas/tickets";
import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { IMAP, INBOUND_EMAIL_SECRET, POLL_INTERVAL_MS, WEBHOOK_URL } from "./env";

// Maps a parsed email onto the webhook's body. Missing fields are sent blank rather than
// guessed, so the webhook rejects them (400) and the email goes to the failed folder.
export function toInboundEmail(mail: ParsedMail): InboundEmailInput {
  const from = mail.from?.value[0];
  const senderEmail = from?.address ?? "";
  const references = mail.references;
  return {
    senderEmail,
    senderName: from?.name || senderEmail,
    subject: mail.subject,
    // mailparser fills `text` from the HTML when the email has no plain-text part.
    body: mail.text ?? "",
    bodyHTML: mail.html || undefined,
    messageId: mail.messageId,
    inReplyTo: mail.inReplyTo,
    references: references === undefined ? undefined : [references].flat(),
  };
}

export type ForwardResult = "processed" | "failed" | "retry";

// 2xx: stored (201) or already stored (200). 400/413: the email itself is invalid or too large,
// so a retry would fail forever. Anything else (a wrong secret's 401, the server down, a 5xx)
// isn't the email's fault, so it stays in the inbox for the next pass.
export async function forward(email: InboundEmailInput): Promise<ForwardResult> {
  let res: Response;
  try {
    res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Inbound-Secret": INBOUND_EMAIL_SECRET },
      body: JSON.stringify(email),
    });
  } catch (error) {
    console.error("[inbound] webhook unreachable:", error);
    return "retry";
  }
  if (res.ok) return "processed";
  const detail = await res.text().catch(() => "");
  console.error(`[inbound] webhook answered ${res.status} for ${email.messageId ?? "(no Message-ID)"}: ${detail}`);
  return res.status === 400 || res.status === 413 ? "failed" : "retry";
}

// One pass over the mailbox: every email in it is forwarded and moved out, so whatever is left
// is waiting for a retry. Emails are handled one at a time, oldest first.
export async function pollOnce() {
  const client = new ImapFlow({
    host: IMAP.host,
    port: IMAP.port,
    secure: IMAP.secure,
    auth: { user: IMAP.user, pass: IMAP.password },
    logger: false,
  });
  await client.connect();
  try {
    const existing = new Set((await client.list()).map((mailbox) => mailbox.path));
    for (const path of [IMAP.processedMailbox, IMAP.failedMailbox]) {
      if (!existing.has(path)) await client.mailboxCreate(path);
    }

    const lock = await client.getMailboxLock(IMAP.mailbox);
    try {
      if (!client.mailbox || client.mailbox.exists === 0) return;
      // UIDs first and each source on its own, so a full inbox isn't held in memory at once.
      const uids = (await client.fetchAll("1:*", { uid: true })).map((message) => message.uid);
      for (const uid of uids) {
        const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!message || !message.source) continue;
        // keepCidLinks: inlined images as data: URLs would push bodyHTML past the webhook's cap.
        const email = toInboundEmail(await simpleParser(message.source, { keepCidLinks: true }));
        const result = await forward(email);
        if (result === "retry") continue;
        const destination = result === "processed" ? IMAP.processedMailbox : IMAP.failedMailbox;
        await client.messageMove(String(uid), destination, { uid: true });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
}

// The next pass is scheduled when the previous one ends, so passes never overlap.
export function startPolling() {
  let timer: ReturnType<typeof setTimeout>;
  let stopped = false;
  const run = async () => {
    try {
      await pollOnce();
    } catch (error) {
      console.error("[inbound] poll failed:", error);
    }
    if (!stopped) timer = setTimeout(run, POLL_INTERVAL_MS);
  };
  void run();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
