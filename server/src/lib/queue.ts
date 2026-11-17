import * as Sentry from "@sentry/bun";
import { PgBoss, type Job } from "pg-boss";
import { isAiConfigured } from "./ai";
import { autoResolveNewTicket, isAutoResolveConfigured } from "./autoResolveTicket";
import { classifyNewTicket, type NewTicket } from "./classifyTicket";
import { isMailerConfigured } from "./env";
import { markReplyEmailFailed, sendReplyEmail, type ReplyEmailJob } from "./sendReplyEmail";

// Background jobs, stored in the pgboss schema of the app's own database, so they survive a
// restart and a failed job is retried.
export const boss = new PgBoss({ connectionString: process.env.DATABASE_URL });

// Without a listener, an error event (e.g. a lost connection) would crash the process.
boss.on("error", (error) => {
  console.error("[queue]", error);
  Sentry.captureException(error);
});

export const CLASSIFY_TICKET_QUEUE = "classify-ticket";
export const AUTO_RESOLVE_TICKET_QUEUE = "auto-resolve-ticket";
export const SEND_REPLY_EMAIL_QUEUE = "send-reply-email";

// A failed OpenAI call or email is tried 3 more times, with exponential backoff starting at 30 s.
const RETRY_OPTIONS = { retryLimit: 3, retryDelay: 30, retryBackoff: true };

// A job that throws is retried by pg-boss, which keeps the error only in pgboss.job, so it's
// reported here too, on every attempt, then rethrown for pg-boss to retry.
function reportFailures<T>(queue: string, handler: (job: Job<T>) => Promise<void>) {
  return async ([job]: Job<T>[]) => {
    if (!job) return;
    try {
      await handler(job);
    } catch (error) {
      Sentry.captureException(error, { tags: { queue }, extra: { jobId: job.id, retryCount: job.retryCount } });
      throw error;
    }
  };
}

// Starts pg-boss and the workers for what's configured: classification with OPENAI_API_KEY,
// auto-resolving with that and the rag service, the reply emails with the mailer. createQueue only creates a missing queue: it doesn't update an
// existing one's options, so a change to the retry settings needs boss.updateQueue.
export async function startQueue(): Promise<void> {
  await boss.start();
  const isLastAttempt = (retryCount: number) => retryCount >= RETRY_OPTIONS.retryLimit;
  if (isAiConfigured) {
    await boss.createQueue(CLASSIFY_TICKET_QUEUE, RETRY_OPTIONS);
    await boss.work<NewTicket>(
      CLASSIFY_TICKET_QUEUE,
      reportFailures(CLASSIFY_TICKET_QUEUE, (job) => classifyNewTicket(job.data)),
    );
  }
  if (isAutoResolveConfigured) {
    await boss.createQueue(AUTO_RESOLVE_TICKET_QUEUE, RETRY_OPTIONS);
    await boss.work<NewTicket>(
      AUTO_RESOLVE_TICKET_QUEUE,
      reportFailures(AUTO_RESOLVE_TICKET_QUEUE, async (job) => {
        const replyId = await autoResolveNewTicket(job.data, isLastAttempt(job.retryCount));
        if (replyId) await queueReplyEmail(replyId);
      }),
    );
  }
  if (isMailerConfigured) {
    await boss.createQueue(SEND_REPLY_EMAIL_QUEUE, RETRY_OPTIONS);
    await boss.work<ReplyEmailJob>(
      SEND_REPLY_EMAIL_QUEUE,
      reportFailures(SEND_REPLY_EMAIL_QUEUE, (job) => sendReplyEmail(job.data, isLastAttempt(job.retryCount))),
    );
  }
}

// Queues the email of a reply stored as pending. The reply is already stored, so a queue failure
// only marks it not sent, for the agent to see.
export async function queueReplyEmail(replyId: number): Promise<void> {
  if (!isMailerConfigured) return;
  try {
    await boss.send(SEND_REPLY_EMAIL_QUEUE, { replyId } satisfies ReplyEmailJob);
  } catch (error) {
    console.error(`[queue] couldn't queue the email of reply ${replyId}:`, error);
    Sentry.captureException(error);
    await markReplyEmailFailed(replyId);
  }
}
