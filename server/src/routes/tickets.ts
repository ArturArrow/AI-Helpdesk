import { Router } from "express";
import { ticketIdParamsSchema, ticketListQuerySchema, UNCLASSIFIED, updateTicketSchema } from "core/schemas/tickets";
import type { Prisma } from "../../generated/prisma/client";
import { Role } from "../../generated/prisma/enums";
import { prisma } from "../lib/db";
import { validate, validateParams, validateQuery } from "../lib/validate";

export const ticketsRouter = Router();

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

// The detail adds the body. bodyHTML is left out: the sender's HTML isn't safe to render.
const ticketDetailSelect = {
  ...ticketListSelect,
  body: true,
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

  // An absent filter is undefined, which Prisma ignores.
  const where: Prisma.TicketWhereInput = {
    status,
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

// assignedToId has no relation, so look the agent up separately. Display only: a
// soft-deleted agent's name still shows on the tickets they had.
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

// Assigns the ticket to an agent, or unassigns it with null. Any signed-in user may do it.
ticketsRouter.patch("/:id", async (req, res) => {
  const params = validateParams(ticketIdParamsSchema, req, res);
  if (!params) return;
  const body = validate(updateTicketSchema, req, res);
  if (!body) return;
  const { assignedToId } = body;

  if (!(await prisma.ticket.findUnique({ where: { id: params.id }, select: { id: true } }))) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }
  if (assignedToId && !(await prisma.user.findUnique({ where: { id: assignedToId, ...activeAgentWhere }, select: { id: true } }))) {
    res.status(400).json({ error: "assignedToId must be an active agent" });
    return;
  }

  const ticket = await prisma.ticket.update({
    where: { id: params.id },
    data: { assignedToId },
    select: ticketDetailSelect,
  });
  res.json({ ticket: await withAssignee(ticket) });
});
