import { Router } from "express";
import { ticketListQuerySchema } from "core/schemas/tickets";
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

// Sorted on the server (the client table uses manualSorting). Defaults to newest first.
// Status and category are Postgres enums, so they sort in declaration order, not by label.
ticketsRouter.get("/", async (req, res) => {
  const query = validateQuery(ticketListQuerySchema, req, res);
  if (!query) return;
  const { sortBy, sortOrder } = query;

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

  const tickets = await prisma.ticket.findMany({ select: ticketListSelect, orderBy });
  res.json({ tickets });
});
