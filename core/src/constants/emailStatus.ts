// Mirrors `enum EmailStatus` in server/prisma/schema.prisma (checked by
// server/src/lib/enumsInSync.ts).
export enum EmailStatus {
  pending = "pending",
  sent = "sent",
  failed = "failed",
}

export const emailStatusLabels: Record<EmailStatus, string> = {
  [EmailStatus.pending]: "Sending…",
  [EmailStatus.sent]: "Emailed",
  [EmailStatus.failed]: "Not sent",
};
