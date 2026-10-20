// Mirrors `enum ReplySender` in server/prisma/schema.prisma (checked by
// server/src/lib/enumsInSync.ts).
export enum ReplySender {
  agent = "agent",
  customer = "customer",
}

export const replySenderLabels: Record<ReplySender, string> = {
  [ReplySender.agent]: "Agent",
  [ReplySender.customer]: "Customer",
};
