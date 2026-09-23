import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import type { Role as SharedRole } from "core/roles";
import { Role } from "../../generated/prisma/enums";
import { prisma } from "./db";
import { BETTER_AUTH_SECRET, BETTER_AUTH_URL, CLIENT_URL } from "./env";

export const CLIENT_IP_HEADER = "x-auth-client-ip";

// Per-account sign-in throttle. The built-in limiter keys only on IP + path, so an attacker
// rotating addresses gets a fresh bucket each time; this caps failed guesses per email
// regardless of source. In memory, like the IP limiter: resets on restart, per instance.
// Like the IP limiter, it runs only in production.
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const MAX_FAILED_SIGN_INS = 5;
const SIGN_IN_LOCKOUT_MS = 15 * 60 * 1000;
const failedSignIns = new Map<string, { count: number; firstFailureAt: number }>();

function signInEmailKey(body: unknown) {
  const email = (body as { email?: unknown } | undefined)?.email;
  return typeof email === "string" ? email.trim().toLowerCase() : null;
}

function activeFailures(email: string, now: number) {
  const entry = failedSignIns.get(email);
  if (entry && now - entry.firstFailureAt >= SIGN_IN_LOCKOUT_MS) {
    failedSignIns.delete(email);
    return undefined;
  }
  return entry;
}

export const auth = betterAuth({
  secret: BETTER_AUTH_SECRET,
  baseURL: BETTER_AUTH_URL,
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
        type: [Role.admin, Role.agent],
        required: true,
        defaultValue: Role.agent,
        // Server-owned: never accepted from API input.
        input: false,
      },
    },
  },
  databaseHooks: {
    session: {
      create: {
        // Soft-deleted users can't get a session. This runs after the password check, so
        // the answer matches a wrong password and doesn't reveal the account existed.
        before: async (session) => {
          const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { deletedAt: true },
          });
          if (user?.deletedAt) {
            throw new APIError("UNAUTHORIZED", { message: "Invalid email or password" });
          }
        },
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (!IS_PRODUCTION || ctx.path !== "/sign-in/email") return;
      const email = signInEmailKey(ctx.body);
      if (!email) return;
      const entry = activeFailures(email, Date.now());
      if (entry && entry.count >= MAX_FAILED_SIGN_INS) {
        // Same response for known and unknown emails, so this doesn't reveal which exist.
        throw new APIError("TOO_MANY_REQUESTS", {
          message: "Too many failed sign-in attempts. Please try again later.",
        });
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (!IS_PRODUCTION || ctx.path !== "/sign-in/email") return;
      const email = signInEmailKey(ctx.body);
      if (!email) return;
      const returned = ctx.context.returned;
      if (!isAPIError(returned)) {
        failedSignIns.delete(email);
        return;
      }
      // Count only wrong credentials, not malformed input or our own 429.
      if (returned.statusCode !== 401) return;
      const now = Date.now();
      const entry = activeFailures(email, now);
      if (entry) entry.count++;
      else {
        // Sprayed emails would otherwise linger until touched again; sweep expired ones.
        if (failedSignIns.size >= 10_000) {
          for (const [key, value] of failedSignIns) {
            if (now - value.firstFailureAt >= SIGN_IN_LOCKOUT_MS) failedSignIns.delete(key);
          }
        }
        failedSignIns.set(email, { count: 1, firstFailureAt: now });
      }
    }),
  },
  trustedOrigins: [CLIENT_URL],
  // Production only, so dev and Playwright runs aren't throttled. Matches Better Auth's
  // default, stated here so it doesn't depend on it. Deploy with NODE_ENV=production.
  rateLimit: { enabled: IS_PRODUCTION },
  advanced: {
    ipAddress: {
      // Set by index.ts from Express's req.ip, never taken from the client. Better Auth
      // otherwise keys the limiter on a raw X-Forwarded-For, which any caller can forge.
      ipAddressHeaders: [CLIENT_IP_HEADER],
    },
  },
});

export type Session = typeof auth.$Infer.Session;

// The client uses the Role from core/roles, which restates this enum. Fails to compile if
// the two drift apart, e.g. after adding a role to schema.prisma but not to core.
const rolesInSync: [Role, SharedRole] extends [SharedRole, Role] ? true : never = true;
void rolesInSync;
