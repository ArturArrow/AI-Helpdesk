// User roles, for code outside the server (the client can't import the generated Prisma
// enum). Mirrors `enum Role` in server/prisma/schema.prisma; server/src/lib/auth.ts fails to
// compile if the two drift apart.
export const Role = {
  admin: "admin",
  agent: "agent",
} as const;

export type Role = (typeof Role)[keyof typeof Role];
