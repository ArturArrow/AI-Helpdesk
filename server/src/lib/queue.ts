import { PgBoss } from "pg-boss";
import { autoResolveNewTicket } from "./autoResolveTicket";
import { classifyNewTicket, type NewTicket } from "./classifyTicket";

// Background jobs, stored in the pgboss schema of the app's own database, so they survive a
// restart and a failed job is retried.
export const boss = new PgBoss({ connectionString: process.env.DATABASE_URL });

// Without a listener, an error event (e.g. a lost connection) would crash the process.
boss.on("error", (error) => console.error("[queue]", error));

export const CLASSIFY_TICKET_QUEUE = "classify-ticket";
export const AUTO_RESOLVE_TICKET_QUEUE = "auto-resolve-ticket";

// A failed OpenAI call is tried 3 more times, with exponential backoff starting at 30 s.
const RETRY_OPTIONS = { retryLimit: 3, retryDelay: 30, retryBackoff: true };

// Starts pg-boss and the workers. createQueue only creates a missing queue: it doesn't update an
// existing one's options, so a change to the retry settings needs boss.updateQueue.
export async function startQueue(): Promise<void> {
  await boss.start();
  await boss.createQueue(CLASSIFY_TICKET_QUEUE, RETRY_OPTIONS);
  await boss.createQueue(AUTO_RESOLVE_TICKET_QUEUE, RETRY_OPTIONS);
  await boss.work<NewTicket>(CLASSIFY_TICKET_QUEUE, async ([job]) => {
    if (job) await classifyNewTicket(job.data);
  });
  await boss.work<NewTicket>(AUTO_RESOLVE_TICKET_QUEUE, async ([job]) => {
    if (job) await autoResolveNewTicket(job.data, job.retryCount >= RETRY_OPTIONS.retryLimit);
  });
}
