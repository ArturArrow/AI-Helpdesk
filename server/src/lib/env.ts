// Fails at import, so the server refuses to start instead of silently falling back
// (Better Auth to a public default secret outside production, cors to "*").
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required. Set it in the environment (see server/.env.example).`);
  }
  return value;
}

export const BETTER_AUTH_SECRET = required("BETTER_AUTH_SECRET");
export const BETTER_AUTH_URL = required("BETTER_AUTH_URL");
export const CLIENT_URL = required("CLIENT_URL");
// Shared secret the mail pipeline sends in X-Inbound-Secret (see middleware/requireWebhookSecret.ts).
export const INBOUND_EMAIL_SECRET = required("INBOUND_EMAIL_SECRET");
// OpenAI key for the AI features (lib/ai.ts). Optional: without it they answer 503.
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// The mailer (mailer/) that emails agent and AI replies. Optional: without both, replies are
// only stored (emailStatus null), as in dev without a mail server and in E2E runs.
export const MAILER_URL = process.env.MAILER_URL;
export const MAILER_SECRET = process.env.MAILER_SECRET;
export const isMailerConfigured = Boolean(MAILER_URL && MAILER_SECRET);
// The rag service (rag/) that stores the knowledge base's documents. Optional: without both,
// /api/rag answers 503.
export const RAG_URL = process.env.RAG_URL;
export const RAG_SECRET = process.env.RAG_SECRET;
export const isRagConfigured = Boolean(RAG_URL && RAG_SECRET);
