import { Router } from "express";
import { prisma } from "../lib/db";

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

// Newest first; id breaks ties between tickets created in the same millisecond.
ticketsRouter.get("/", async (_req, res) => {
  const tickets = await prisma.ticket.findMany({
    select: ticketListSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  res.json({ tickets });
});
