import express, { type ErrorRequestHandler } from "express";
import { PORT } from "./env";
import { startPolling } from "./inbound";
import { sendRouter, transporter } from "./outbound";

const app = express();

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use(sendRouter);

// Must stay last: a JSON error instead of Express's HTML stack trace (e.g. for a malformed body).
const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err?.expose ? err.message : "Internal Server Error" });
};
app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`Mailer listening on http://localhost:${PORT}`);
});

// A wrong SMTP setting shows up at startup rather than on the first reply.
transporter.verify().then(
  () => console.log("[outbound] SMTP connection OK"),
  (error) => console.error("[outbound] SMTP connection failed:", error),
);

const stopPolling = startPolling();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopPolling();
    server.close(() => process.exit(0));
  });
}
