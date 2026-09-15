import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./db";

// BETTER_AUTH_SECRET and BETTER_AUTH_URL are read from the environment.
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    // Accounts are seeded (admin) or created by an admin, never self-registered.
    disableSignUp: true,
  },
  trustedOrigins: process.env.CLIENT_URL ? [process.env.CLIENT_URL] : [],
});

export type Session = typeof auth.$Infer.Session;
