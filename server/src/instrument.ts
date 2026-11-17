import * as Sentry from "@sentry/bun";
import { SENTRY_DSN, SENTRY_ENVIRONMENT } from "./lib/env";

// Error reporting. Imported first in index.ts so it's set up before anything else runs.
// Optional: without SENTRY_DSN the SDK is disabled and sends nothing (dev, E2E, unit tests).
// Errors only, no tracing: Bun can't auto-instrument Express without the build plugin, so 5xx
// errors are reported by the error handler in index.ts and failed jobs by the workers in queue.ts.
Sentry.init({
  dsn: SENTRY_DSN,
  environment: SENTRY_ENVIRONMENT,
  // Customer emails, replies and passwords pass through request bodies, and the SDK keeps a raw
  // copy of them that isn't filtered like headers are, so they never leave the server.
  beforeSend(event) {
    if (event.request) delete event.request.data;
    return event;
  },
});
