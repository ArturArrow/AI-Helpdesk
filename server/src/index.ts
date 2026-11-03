import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { toNodeHandler } from "better-auth/node";
import { isAiConfigured } from "./lib/ai";
import { auth, CLIENT_IP_HEADER } from "./lib/auth";
import { prisma } from "./lib/db";
import { CLIENT_URL, isMailerConfigured } from "./lib/env";
import { boss, startQueue } from "./lib/queue";
import { requireAdmin } from "./middleware/requireAdmin";
import { requireAuth } from "./middleware/requireAuth";
import { requireWebhookSecret } from "./middleware/requireWebhookSecret";
import { ticketsRouter } from "./routes/tickets";
import { usersRouter } from "./routes/users";
import { webhookRouter } from "./routes/webhook";

const app = express();
const port = process.env.PORT ?? 3001;

app.use(cors({ origin: CLIENT_URL, credentials: true }));

// Always overwritten, so a client-supplied value never reaches the rate limiter.
// req.ip is the socket address; behind a reverse proxy, set app.set("trust proxy", ...)
// to the proxy's address so it resolves to the real client instead.
app.use("/api/auth", (req, _res, next) => {
  if (req.ip) req.headers[CLIENT_IP_HEADER] = req.ip;
  else delete req.headers[CLIENT_IP_HEADER];
  next();
});

// Must be mounted before express.json(), which would consume the request body.
app.all("/api/auth/*splat", toNodeHandler(auth));

// Called by the mail pipeline, not a signed-in user: a shared secret instead of a session.
// Emails can be larger than the 100 kB default, so the webhooks get their own 1 MB parser
// (the schema caps body and bodyHTML), after the secret check so only a known caller can
// send that much. Mounted before the global parser, which then skips these requests.
app.use("/api/webhooks", requireWebhookSecret, express.json({ limit: "1mb" }), webhookRouter);

app.use(express.json());

// Every /api/users route is admin-only; guarding the prefix covers routes added later.
app.use("/api/users", requireAuth, requireAdmin, usersRouter);

// Tickets are worked by agents and admins alike, so any signed-in user may read and assign them.
app.use("/api/tickets", requireAuth, ticketsRouter);

app.get("/api/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/health/db", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok" });
  } catch (error) {
    console.error("Database health check failed:", error);
    res.status(503).json({ status: "error" });
  }
});

// Must stay last. Without it Express's finalhandler renders err.stack whenever
// NODE_ENV isn't "production" — e.g. a malformed JSON body or a DB error in requireAuth.
// http-errors (used by express.json()) marks client errors as safe to show via `expose`.
const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err?.expose ? err.message : "Internal Server Error" });
};
app.use(errorHandler);

app.listen(port, async () => {
  console.log(`Server listening on http://localhost:${port}`);

  try {
    await prisma.$connect();
    console.log("Connected to the helpdesk database");
  } catch (error) {
    console.error("Failed to connect to the database:", error);
  }

  // The jobs are the AI's (classification, auto-resolving) and the reply emails, so with
  // neither configured pg-boss isn't started at all.
  if (!isAiConfigured && !isMailerConfigured) return;
  try {
    await startQueue();
    console.log("Background job queue started");
  } catch (error) {
    console.error("Failed to start the background job queue:", error);
    return;
  }

  // Lets a running job finish before the process exits.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, async () => {
      await boss.stop();
      process.exit(0);
    });
  }
});
