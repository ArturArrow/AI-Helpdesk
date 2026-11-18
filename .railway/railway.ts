// Railway infrastructure for the helpdesk. Review with `railway config plan`, apply with
// `railway config apply`. Secrets are never written here: `preserve()` keeps whatever value
// is set in Railway (`railway variable set KEY=... --service <name>`), and the other services
// reference the one service that holds each secret.
import { defineRailway, github, postgres, preserve, project, service } from "railway/iac";

// Every service builds from this repository; a push to main deploys it.
const repo = github("ArturArrow/AI-Helpdesk", { branch: "main" });

export default defineRailway(() => {
  // Two databases, both on Railway's Postgres 18 image, which ships pgvector. The rag service
  // gets its own: Prisma would read its tables in the helpdesk database as drift.
  const db = postgres("postgres");
  const ragDb = postgres("postgres-rag");

  // Not public: only the server calls it, over the private network.
  const rag = service("rag", {
    source: repo,
    build: { builder: "DOCKERFILE", dockerfilePath: "rag/Dockerfile" },
    healthcheck: "/health",
    env: {
      PORT: "3003",
      DATABASE_URL: ragDb.env.DATABASE_URL,
      OPENAI_API_KEY: preserve(),
      RAG_SECRET: preserve(),
      SENTRY_DSN: preserve(),
      SENTRY_ENVIRONMENT: "production",
    },
  });

  // Not public either: it polls IMAP itself and the server calls its /send privately.
  const mailer = service("mailer", {
    source: repo,
    build: { builder: "DOCKERFILE", dockerfilePath: "mailer/Dockerfile" },
    healthcheck: "/health",
    env: {
      PORT: "3002",
      WEBHOOK_URL: "http://server.railway.internal:3001/api/webhooks/inbound-email",
      INBOUND_EMAIL_SECRET: preserve(),
      MAILER_SECRET: preserve(),
      IMAP_HOST: preserve(),
      IMAP_USER: preserve(),
      IMAP_PASSWORD: preserve(),
      SMTP_HOST: preserve(),
      SMTP_USER: preserve(),
      SMTP_PASSWORD: preserve(),
      MAIL_FROM: preserve(),
      SENTRY_DSN: preserve(),
      SENTRY_ENVIRONMENT: "production",
    },
  });

  // The public one: the API plus the built client on one origin.
  const server = service("server", {
    source: repo,
    build: { builder: "DOCKERFILE", dockerfilePath: "server/Dockerfile" },
    // Runs in the new image before it takes traffic; a failed migration stops the deploy.
    preDeploy: "bun run db:deploy",
    healthcheck: "/api/health",
    env: {
      PORT: "3001",
      DATABASE_URL: db.env.DATABASE_URL,
      BETTER_AUTH_URL: "https://${{RAILWAY_PUBLIC_DOMAIN}}",
      CLIENT_URL: "https://${{RAILWAY_PUBLIC_DOMAIN}}",
      // Railway's edge proxy, so req.ip (and the sign-in rate limit) sees the real client.
      TRUST_PROXY: "1",
      BETTER_AUTH_SECRET: preserve(),
      OPENAI_API_KEY: rag.env.OPENAI_API_KEY,
      INBOUND_EMAIL_SECRET: mailer.env.INBOUND_EMAIL_SECRET,
      MAILER_URL: "http://mailer.railway.internal:3002",
      MAILER_SECRET: mailer.env.MAILER_SECRET,
      RAG_URL: "http://rag.railway.internal:3003",
      RAG_SECRET: rag.env.RAG_SECRET,
      SENTRY_DSN: preserve(),
      SENTRY_ENVIRONMENT: "production",
      // Build args for the client bundle (see server/Dockerfile).
      VITE_SENTRY_DSN: preserve(),
      VITE_SENTRY_ENVIRONMENT: "production",
    },
  });

  return project("helpdesk", { resources: [db, ragDb, rag, mailer, server] });
});
