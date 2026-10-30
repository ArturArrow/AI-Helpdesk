import { Router } from "express";
import type { TicketStats } from "core/constants/ticket";
import { VISIBLE_TICKET_STATUSES } from "core/constants/ticketStatus";
import {
  statsPeriodDays,
  ticketIdParamsSchema,
  ticketListQuerySchema,
  ticketStatsQuerySchema,
  UNCLASSIFIED,
  updateTicketSchema,
} from "core/schemas/tickets";
import { Prisma } from "../../generated/prisma/client";
import { ReplySender, Role, TicketStatus } from "../../generated/prisma/enums";
import { isAiConfigured, summarizeTicket } from "../lib/ai";
import { prisma } from "../lib/db";
import { loadTicketContext } from "../lib/ticketContext";
import { validate, validateParams, validateQuery } from "../lib/validate";
import { repliesRouter } from "./replies";

export const ticketsRouter = Router();

// A ticket's thread. Mounted here so it sits behind the same requireAuth as the tickets.
ticketsRouter.use("/:id/replies", repliesRouter);

// Explicit select: the list doesn't need the bodies, and new columns aren't exposed by default.
const ticketListSelect = {
  id: true,
  subject: true,
  senderName: true,
  senderEmail: true,
  status: true,
  category: true,
  createdAt: true,
} as const;

// The detail adds the bodies. bodyHTML is the sender's raw HTML: the client must sanitize it before rendering.
const ticketDetailSelect = {
  ...ticketListSelect,
  body: true,
  bodyHTML: true,
  assignedToId: true,
  updatedAt: true,
} as const;

const searchFields = ["subject", "senderName", "senderEmail", "body"] as const;

// Prisma passes `contains` to LIKE unescaped, so "%" or "_" would match every ticket.
// Backslash is Postgres's default LIKE escape character.
function escapeLike(text: string) {
  return text.replace(/[\\%_]/g, "\\$&");
}

// Filtered, sorted and paginated on the server (the client table uses manualSorting).
// Defaults to all tickets, newest first, first page of DEFAULT_TICKET_PAGE_SIZE.
// Status and category are Postgres enums, so they sort in declaration order, not by label.
ticketsRouter.get("/", async (req, res) => {
  const query = validateQuery(ticketListQuerySchema, req, res);
  if (!query) return;
  const { sortBy, sortOrder, status, category, q, page, pageSize } = query;

  // An absent filter is undefined, which Prisma ignores. Without a status filter, tickets the AI
  // is still handling (new, processing) are left out.
  const where: Prisma.TicketWhereInput = {
    status: status ?? { in: [...VISIBLE_TICKET_STATUSES] },
    category: category === UNCLASSIFIED ? null : category,
    // An ILIKE '%q%' scan per field: fine at this size; a trigram index or full-text search
    // would be the next step if the table grows.
    OR: q
      ? searchFields.map((field) => ({ [field]: { contains: escapeLike(q), mode: "insensitive" } }))
      : undefined,
  };

  // Tie-breaks keep the order stable: newest first within equal values, then id.
  const orderBy: Prisma.TicketOrderByWithRelationInput[] =
    sortBy === "createdAt"
      ? [{ createdAt: sortOrder }, { id: sortOrder }]
      : [
          // Unclassified tickets go last in both directions.
          sortBy === "category" ? { category: { sort: sortOrder, nulls: "last" } } : { [sortBy]: sortOrder },
          { createdAt: "desc" },
          { id: "desc" },
        ];

  // One transaction, so the total matches the page it's reported with.
  const [tickets, total] = await prisma.$transaction([
    prisma.ticket.findMany({
      where,
      select: ticketListSelect,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.ticket.count({ where }),
  ]);
  res.json({ tickets, total });
});

// Who a ticket can be assigned to: active agents. Declared before /:id, which would
// otherwise take "assignees" as an id.
const activeAgentWhere = { deletedAt: null, role: Role.agent } as const;

ticketsRouter.get("/assignees", async (_req, res) => {
  const agents = await prisma.user.findMany({
    where: activeAgentWhere,
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  res.json({ agents });
});

const FINISHED_STATUSES: TicketStatus[] = [TicketStatus.resolved, TicketStatus.closed];

const DAY_MS = 24 * 60 * 60 * 1000;

// The dashboard's numbers, for any signed-in user. Total counts every ticket, including those the
// AI is still handling. A ticket counts as resolved by the AI while it's finished and has an AI
// reply. The period limits total, resolvedByAi and the average to tickets created in it, so the
// AI share compares like with like; open is always the backlog now. Declared before /:id, like
// /assignees.
ticketsRouter.get("/stats", async (req, res) => {
  const query = validateQuery(ticketStatsQuerySchema, req, res);
  if (!query) return;
  const { period } = query;

  const since = period === "all" ? undefined : new Date(Date.now() - statsPeriodDays[period] * DAY_MS);
  const created = since ? { createdAt: { gte: since } } : {};
  const finished = { ...created, status: { in: FINISHED_STATUSES } };
  // Prisma's aggregate can't average a difference of two columns, hence the raw query.
  const [total, open, resolvedByAi, [{ averageResolutionMs }]] = await prisma.$transaction([
    prisma.ticket.count({ where: created }),
    prisma.ticket.count({ where: { status: TicketStatus.open } }),
    prisma.ticket.count({ where: { ...finished, replies: { some: { sender: ReplySender.ai } } } }),
    prisma.$queryRaw<[{ averageResolutionMs: number | null }]>`
      SELECT (AVG(EXTRACT(EPOCH FROM ("resolvedAt" - "createdAt"))) * 1000)::float8 AS "averageResolutionMs"
      FROM "ticket"
      WHERE "status" IN (${Prisma.join(FINISHED_STATUSES.map((status) => Prisma.sql`${status}::"TicketStatus"`))})
        AND "resolvedAt" IS NOT NULL
        ${since ? Prisma.sql`AND "createdAt" >= ${since}` : Prisma.empty}`,
  ]);
  const stats: TicketStats = { total, open, resolvedByAi, averageResolutionMs };
  res.json(stats);
});

// assignedToId has no relation, so look the agent up separately. Deleting an agent
// unassigns their tickets, but the lookup skips the deletedAt filter so a ticket assigned
// before that rule existed still shows the deleted agent's name.
type TicketDetailRow = Prisma.TicketGetPayload<{ select: typeof ticketDetailSelect }>;

async function withAssignee({ assignedToId, ...ticket }: TicketDetailRow) {
  const assignedTo = assignedToId
    ? await prisma.user.findUnique({ where: { id: assignedToId }, select: { id: true, name: true } })
    : null;
  return { ...ticket, assignedTo };
}

ticketsRouter.get("/:id", async (req, res) => {
  const params = validateParams(ticketIdParamsSchema, req, res);
  if (!params) return;

  const ticket = await prisma.ticket.findUnique({ where: { id: params.id }, select: ticketDetailSelect });
  if (!ticket) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }
  res.json({ ticket: await withAssignee(ticket) });
});

// Stamped when a ticket becomes finished, kept when it moves between resolved and closed,
// cleared when it's reopened. Undefined leaves the column unchanged.
function resolvedAtFor(current: TicketStatus, next: TicketStatus): Date | null | undefined {
  const wasFinished = FINISHED_STATUSES.includes(current);
  if (!FINISHED_STATUSES.includes(next)) return null;
  return wasFinished ? undefined : new Date();
}

// Changes the assignee, status and/or category; fields left out are kept. Any signed-in
// user may do it.
ticketsRouter.patch("/:id", async (req, res) => {
  const params = validateParams(ticketIdParamsSchema, req, res);
  if (!params) return;
  const body = validate(updateTicketSchema, req, res);
  if (!body) return;
  const { assignedToId, status, category } = body;

  const current = await prisma.ticket.findUnique({ where: { id: params.id }, select: { status: true } });
  if (!current) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }
  if (assignedToId && !(await prisma.user.findUnique({ where: { id: assignedToId, ...activeAgentWhere }, select: { id: true } }))) {
    res.status(400).json({ error: "assignedToId must be an active agent" });
    return;
  }

  const ticket = await prisma.ticket.update({
    where: { id: params.id },
    // Prisma leaves undefined fields unchanged.
    data: { assignedToId, status, category, resolvedAt: status && resolvedAtFor(current.status, status) },
    select: ticketDetailSelect,
  });
  res.json({ ticket: await withAssignee(ticket) });
});

// An AI summary of the ticket and its thread. Nothing is stored, so each request summarizes
// the thread as it is now.
ticketsRouter.post("/:id/summary", async (req, res) => {
  const params = validateParams(ticketIdParamsSchema, req, res);
  if (!params) return;

  const ticket = await loadTicketContext(params.id);
  if (!ticket) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }
  if (!isAiConfigured) {
    res.status(503).json({ error: "AI isn't configured" });
    return;
  }
  res.json({ summary: await summarizeTicket(ticket) });
});
