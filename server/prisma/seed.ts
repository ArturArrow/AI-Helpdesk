import { auth } from "../src/lib/auth";
import { prisma } from "../src/lib/db";

const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME = "Admin" } = process.env;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set");
}

// Public sign-up is disabled, so create the user the same way Better Auth's
// sign-up endpoint does: user row + "credential" account with a hashed password.
const ctx = await auth.$context;
const email = ADMIN_EMAIL.toLowerCase();

if (await ctx.internalAdapter.findUserByEmail(email)) {
  console.log(`Admin ${email} already exists, skipping`);
} else {
  const user = await ctx.internalAdapter.createUser(
    { email, name: ADMIN_NAME, emailVerified: true },
    { method: "email-password" },
  );

  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await ctx.password.hash(ADMIN_PASSWORD),
  });

  console.log(`Created admin ${email}`);
}

await prisma.$disconnect();
