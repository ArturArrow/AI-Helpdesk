// What the tests use in place of ./env, which would throw without a real .env.
export const testEnv = {
  PORT: 0,
  IMAP: {
    host: "imap.test",
    port: 993,
    secure: true,
    user: "u",
    password: "p",
    mailbox: "INBOX",
    processedMailbox: "Processed",
    failedMailbox: "Failed",
  },
  POLL_INTERVAL_MS: 30_000,
  WEBHOOK_URL: "http://server.test/api/webhooks/inbound-email",
  INBOUND_EMAIL_SECRET: "inbound-secret",
  SMTP: { host: "smtp.test", port: 465, secure: true, user: "u", password: "p" },
  MAIL_FROM: "Helpdesk <support@example.com>",
  MAILER_SECRET: "mailer-secret",
};
