// Mirrors `enum ReplySender` in server/prisma/schema.prisma (checked by
// server/src/lib/enumsInSync.ts).
export enum ReplySender {
  agent = "agent",
  customer = "customer",
  ai = "ai",
}

export const replySenderLabels: Record<ReplySender, string> = {
  [ReplySender.agent]: "Agent",
  [ReplySender.customer]: "Customer",
  [ReplySender.ai]: "AI",
};
