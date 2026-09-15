import { auth } from "../src/lib/auth";
import { prisma } from "../src/lib/db";

// Creates (or repairs) the admin account. Safe to run repeatedly, including
// against a fresh production database after `bun run db:deploy`.

const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME = "Admin", NODE_ENV } = process.env;

async function fail(message: string): Promise<never> {
  console.error(`Seed failed: ${message}`);
  await prisma.$disconnect();
  process.exit(1);
}

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  await fail("ADMIN_EMAIL and ADMIN_PASSWORD must be set");
}

const email = ADMIN_EMAIL!.trim().toLowerCase();
const password = ADMIN_PASSWORD!;
const ctx = await auth.$context;
const { minPasswordLength, maxPasswordLength } = ctx.password.config;

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  await fail(`ADMIN_EMAIL "${email}" is not a valid email address`);
}
if (password.length < minPasswordLength || password.length > maxPasswordLength) {
  await fail(`ADMIN_PASSWORD must be ${minPasswordLength}-${maxPasswordLength} characters long`);
}
if (NODE_ENV === "production" && email === "admin@example.com") {
  await fail("ADMIN_EMAIL is still the placeholder admin@example.com; set a real address for production");
}

// Public sign-up is disabled, so create the user the same way Better Auth's
// sign-up endpoint does: user row + "credential" account with a hashed password.
async function linkCredential(userId: string) {
  await ctx.internalAdapter.linkAccount({
    userId,
    providerId: "credential",
    accountId: userId,
    password: await ctx.password.hash(password),
  });
}

const existing = await ctx.internalAdapter.findUserByEmail(email, { includeAccounts: true });

if (!existing) {
  const user = await ctx.internalAdapter.createUser(
    { email, name: ADMIN_NAME, emailVerified: true, role: "admin" },
    { method: "email-password" },
  );
  await linkCredential(user.id);
  console.log(`Created admin ${email}`);
} else {
  await prisma.user.update({
    where: { id: existing.user.id },
    data: { role: "admin", emailVerified: true },
  });

  // Repairs an admin whose credential account was never created (e.g. a
  // previous run failed halfway). An existing password is never overwritten.
  if (existing.accounts.some((account) => account.providerId === "credential")) {
    console.log(`Admin ${email} already exists, ensured admin role (password left unchanged)`);
  } else {
    await linkCredential(existing.user.id);
    console.log(`Admin ${email} already exists, ensured admin role and set missing password`);
  }
}

await prisma.$disconnect();
