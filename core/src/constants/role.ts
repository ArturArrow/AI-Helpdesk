// Mirrors `enum Role` in server/prisma/schema.prisma, for code outside the server (the
// client can't import the generated Prisma enums). server/src/lib/enumsInSync.ts fails to
// compile if the two drift apart.
export enum Role {
  admin = "admin",
  agent = "agent",
}
