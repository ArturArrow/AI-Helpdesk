// core/constants restates the Prisma enums for the client. Each check fails to compile if
// the two drift apart, e.g. after adding a value to schema.prisma but not to core.
// Only the server's tsc sees this file: run `bun run --filter server typecheck`.
import type { Role as SharedRole } from "core/constants/role";
import type { TicketCategory as SharedTicketCategory } from "core/constants/ticketCategory";
import type { TicketStatus as SharedTicketStatus } from "core/constants/ticketStatus";
import type { Role, TicketCategory, TicketStatus } from "../../generated/prisma/enums";

// TS string enums are nominal, so compare their values (`${E}`) with Prisma's string unions.
type Same<A, B> = [A, B] extends [B, A] ? true : never;

export const enumsInSync: [
  Same<`${SharedRole}`, Role>,
  Same<`${SharedTicketStatus}`, TicketStatus>,
  Same<`${SharedTicketCategory}`, TicketCategory>,
] = [true, true, true];
