import * as Sentry from "@sentry/bun";

// Error reporting. Imported first in index.ts so it's set up before anything else runs.
// Optional: without SENTRY_DSN the SDK is disabled and sends nothing.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // Where it runs, set apart from NODE_ENV (a staging deploy also runs with production). The
  // fallbacks keep dev from reporting as the SDK's default, production.
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
  // POST /send carries whole emails and their attachments, which never leave the mailer.
  beforeSend(event) {
    if (event.request) delete event.request.data;
    return event;
  },
});
