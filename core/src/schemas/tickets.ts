import { z } from "zod";
import { TicketCategory } from "../constants/ticketCategory";
import { TicketStatus } from "../constants/ticketStatus";

// Body of POST /api/webhooks/inbound-email. Provider-neutral: a SendGrid/Mailgun adapter
// (or a forwarding script) maps its own format onto this.
export const inboundEmailSchema = z.object({
  senderEmail: z
    .string({ error: "senderEmail is required" })
    .trim()
    .toLowerCase()
    .pipe(z.email("senderEmail must be a valid email address")),
  senderName: z.string({ error: "senderName is required" }).trim().min(1, "senderName is required"),
  // 998 is the RFC 5322 line-length limit for a header.
  subject: z
    .string()
    .trim()
    .max(998, "subject is too long")
    .optional()
    .transform((subject) => subject || "(no subject)"),
  body: z.string({ error: "body is required" }).trim().min(1, "body is required"),
  bodyHTML: z.string().optional(),
  messageId: z.string().trim().min(1).optional(),
});

export type InboundEmailInput = z.input<typeof inboundEmailSchema>;

// Query of GET /api/tickets. The table sorts and filters on the server; each sort field is a
// sortable column. A missing filter means "all"; category=unclassified means no category yet;
// q is a case-insensitive text search.
export const ticketSortFields = ["subject", "senderName", "status", "category", "createdAt"] as const;

export const UNCLASSIFIED = "unclassified";

export const ticketListQuerySchema = z.object({
  sortBy: z
    .enum(ticketSortFields, { error: `sortBy must be one of: ${ticketSortFields.join(", ")}` })
    .default("createdAt"),
  sortOrder: z.enum(["asc", "desc"], { error: "sortOrder must be asc or desc" }).default("desc"),
  status: z
    .enum(TicketStatus, { error: `status must be one of: ${Object.values(TicketStatus).join(", ")}` })
    .optional(),
  category: z
    .enum(
      { ...TicketCategory, [UNCLASSIFIED]: UNCLASSIFIED },
      { error: `category must be one of: ${[...Object.values(TicketCategory), UNCLASSIFIED].join(", ")}` },
    )
    .optional(),
  // Free-text search over subject, sender and body. Blank means no text filter.
  q: z.string({ error: "q must be a single string" }).trim().max(200, "q is too long").optional(),
});

export type TicketSortField = (typeof ticketSortFields)[number];
export type TicketListQuery = z.infer<typeof ticketListQuerySchema>;
export type TicketCategoryFilter = NonNullable<TicketListQuery["category"]>;
