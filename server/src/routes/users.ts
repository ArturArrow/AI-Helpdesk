import { Router, type Request, type Response } from "express";
import { createUserSchema, updateUserSchema } from "core/schemas/users";
import { auth } from "../lib/auth";
import { Role } from "../../generated/prisma/enums";
import { prisma } from "../lib/db";

export const usersRouter = Router();

// Explicit select, so columns added to User later aren't exposed by default.
const userSelect = { id: true, name: true, email: true, role: true, createdAt: true } as const;

type Schema<T> = {
  safeParse(data: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: { message: string }[] } };
};

// Soft-deleted users count as missing everywhere except the email uniqueness checks,
// which still see them, so a deleted user's email stays reserved.
function findActiveUser(id: string) {
  return prisma.user.findUnique({ where: { id, deletedAt: null }, select: { role: true } });
}

// Parses the body, or replies 400 with the first issue and returns undefined.
function validate<T>(schema: Schema<T>, req: Request, res: Response) {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]!.message });
    return;
  }
  return parsed.data;
}

usersRouter.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: userSelect,
    orderBy: { createdAt: "asc" },
  });
  res.json({ users });
});

usersRouter.post("/", async (req, res) => {
  const ctx = await auth.$context;
  const body = validate(createUserSchema, req, res);
  if (!body) return;
  const { name, email, password } = body;

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

usersRouter.patch("/:id", async (req, res) => {
  const ctx = await auth.$context;
  const body = validate(updateUserSchema, req, res);
  if (!body) return;
  const { name, email, password } = body;
  const { id } = req.params;

  if (!(await findActiveUser(id))) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const existing = await ctx.internalAdapter.findUserByEmail(email);
  if (existing && existing.user.id !== id) {
    res.status(409).json({ error: "A user with this email already exists" });
    return;
  }

  await ctx.internalAdapter.updateUser(id, { name, email });
  // No password means keep the current one. A new one matches the credential account by
  // accountId === userId, which is how POST and the seed link it, and ends the user's
  // sessions so nothing signed in under the old password outlives the reset.
  if (password) {
    await ctx.internalAdapter.updatePassword(id, await ctx.password.hash(password));
    await ctx.internalAdapter.deleteUserSessions(id);
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id }, select: userSelect });
  res.json({ user });
});

usersRouter.delete("/:id", async (req, res) => {
  const ctx = await auth.$context;
  const { id } = req.params;

  const user = await findActiveUser(id);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (user.role === Role.admin) {
    res.status(403).json({ error: "Admins cannot be deleted" });
    return;
  }

  // Soft delete: keep the row, end the sessions. The session.create hook in auth.ts stops
  // the user from signing in again.
  await prisma.user.update({ where: { id }, data: { deletedAt: new Date() } });
  await ctx.internalAdapter.deleteUserSessions(id);
  res.status(204).end();
});
