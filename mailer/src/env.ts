// Read once at import, so the mailer refuses to start with a missing setting instead of
// polling or sending with a blank one.
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required. Set it in the environment (see mailer/.env.example).`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  if (raw !== "true" && raw !== "false") throw new Error(`${name} must be true or false.`);
  return raw === "true";
}

export const PORT = int("PORT", 3002);

export const IMAP = {
  host: required("IMAP_HOST"),
  port: int("IMAP_PORT", 993),
  secure: bool("IMAP_SECURE", true),
  user: required("IMAP_USER"),
  password: required("IMAP_PASSWORD"),
  mailbox: optional("IMAP_MAILBOX", "INBOX"),
  processedMailbox: optional("IMAP_PROCESSED_MAILBOX", "Processed"),
  failedMailbox: optional("IMAP_FAILED_MAILBOX", "Failed"),
};
export const POLL_INTERVAL_MS = int("POLL_INTERVAL_MS", 30_000);

// The server's inbound-email webhook and its shared secret (INBOUND_EMAIL_SECRET in server/.env).
export const WEBHOOK_URL = required("WEBHOOK_URL");
export const INBOUND_EMAIL_SECRET = required("INBOUND_EMAIL_SECRET");

export const SMTP = {
  host: required("SMTP_HOST"),
  port: int("SMTP_PORT", 465),
  secure: bool("SMTP_SECURE", true),
  user: required("SMTP_USER"),
  password: required("SMTP_PASSWORD"),
};
// The From of every outgoing email, e.g. "Helpdesk <support@example.com>".
export const MAIL_FROM = required("MAIL_FROM");

// Callers of POST /send (the server) send it in X-Mailer-Secret.
export const MAILER_SECRET = required("MAILER_SECRET");
