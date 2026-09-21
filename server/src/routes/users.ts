import { Router } from "express";
import { prisma } from "../lib/db";

export const usersRouter = Router();

usersRouter.get("/", async (_req, res) => {
  // Explicit select, so columns added to User later aren't exposed by default.
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  res.json({ users });
});
