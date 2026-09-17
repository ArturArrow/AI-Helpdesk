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
  user: {
    additionalFields: {
      role: {
        // required + defaultValue: the column is non-nullable with a DB default, so this
        // types `user.role` as "admin" | "agent" rather than widening it with null/undefined.
        // Safe despite input: false — parseInputData fills the default before it can ever
        // throw "role is required".
        type: ["admin", "agent"],
        required: true,
        defaultValue: "agent",
        // Server-owned: never accepted from API input.
        input: false,
      },
    },
  },
  trustedOrigins: process.env.CLIENT_URL ? [process.env.CLIENT_URL] : [],
});

export type Session = typeof auth.$Infer.Session;
