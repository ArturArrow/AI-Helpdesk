import { Router } from "express";
import { createUserSchema } from "core/schemas/users";
import { auth } from "../lib/auth";
import { Role } from "../../generated/prisma/enums";
import { prisma } from "../lib/db";

export const usersRouter = Router();

// Explicit select, so columns added to User later aren't exposed by default.
const userSelect = { id: true, name: true, email: true, role: true, createdAt: true } as const;

usersRouter.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({
    select: userSelect,
    orderBy: { createdAt: "asc" },
  });
  res.json({ users });
});

usersRouter.post("/", async (req, res) => {
  const ctx = await auth.$context;
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]!.message });
    return;
  }
  const { name, email, password } = parsed.data;

  if (await ctx.internalAdapter.findUserByEmail(email)) {
    res.status(409).json({ error: "A user with this email already exists" });
    return;
  }

  // Sign-up is disabled, so create the user the way seed.ts does: user row + "credential"
  // account, hashed with Better Auth's own hasher so the password authenticates.
  const created = await ctx.internalAdapter.createUser(
    { email, name, emailVerified: true, role: Role.agent },
    { method: "email-password" },
  );
  await ctx.internalAdapter.linkAccount({
    userId: created.id,
    providerId: "credential",
    accountId: created.id,
    password: await ctx.password.hash(password),
  });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: created.id }, select: userSelect });
  res.status(201).json({ user });
});
