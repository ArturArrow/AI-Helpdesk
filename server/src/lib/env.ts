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
// How many reverse proxies sit in front of the server (1 on Railway, its edge proxy). Optional:
// without it req.ip is the socket address, which behind a proxy is the proxy's, so every client
// would share one sign-in rate-limit bucket. Never set it without a proxy: clients could then
// forge X-Forwarded-For.
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy && !/^\d+$/.test(trustProxy)) throw new Error("TRUST_PROXY must be a number of proxy hops.");
export const TRUST_PROXY_HOPS = trustProxy ? Number(trustProxy) : undefined;
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
// Sentry project DSN for error reporting (src/instrument.ts). Optional: without it nothing is sent.
export const SENTRY_DSN = process.env.SENTRY_DSN;
// Where it runs (production, staging, development), set apart from NODE_ENV, which says how it
// runs: a staging deploy also runs with NODE_ENV=production. Falls back to NODE_ENV, then
// development, since the SDK's own default is production.
export const SENTRY_ENVIRONMENT = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development";
