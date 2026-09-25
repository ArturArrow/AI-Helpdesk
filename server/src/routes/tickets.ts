import { Router } from "express";
import { ticketListQuerySchema, UNCLASSIFIED } from "core/schemas/tickets";
import type { Prisma } from "../../generated/prisma/client";
import { prisma } from "../lib/db";
import { validateQuery } from "../lib/validate";

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
