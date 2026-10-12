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
export const DEFAULT_TICKET_PAGE_SIZE = 10;
export const MAX_TICKET_PAGE_SIZE = 100;

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
  // 1-based. A page past the end returns no tickets, with the real total.
  page: z.coerce
    .number({ error: "page must be a positive integer" })
    .int("page must be a positive integer")
    .min(1, "page must be a positive integer")
    // Keeps (page - 1) * pageSize within Prisma's 32-bit `skip`.
    .max(1_000_000, "page is too large")
    .default(1),
  pageSize: z.coerce
    .number({ error: `pageSize must be an integer from 1 to ${MAX_TICKET_PAGE_SIZE}` })
    .int(`pageSize must be an integer from 1 to ${MAX_TICKET_PAGE_SIZE}`)
    .min(1, `pageSize must be an integer from 1 to ${MAX_TICKET_PAGE_SIZE}`)
    .max(MAX_TICKET_PAGE_SIZE, `pageSize must be an integer from 1 to ${MAX_TICKET_PAGE_SIZE}`)
    .default(DEFAULT_TICKET_PAGE_SIZE),
});

export type TicketSortField = (typeof ticketSortFields)[number];
export type TicketListQuery = z.infer<typeof ticketListQuerySchema>;
export type TicketCategoryFilter = NonNullable<TicketListQuery["category"]>;

// Params of GET /api/tickets/:id. The upper bound is Postgres int4's, so an oversized id is a
// 400 rather than a database error.
export const ticketIdParamsSchema = z.object({
  id: z.coerce
    .number({ error: "id must be a positive integer" })
    .int("id must be a positive integer")
    .min(1, "id must be a positive integer")
    .max(2_147_483_647, "id must be a positive integer"),
});

// Body of PATCH /api/tickets/:id. Each field is optional, but at least one must be given;
// a null assignedToId unassigns and a null category marks the ticket unclassified. The server
// checks that assignedToId is an active agent.
export const updateTicketSchema = z
  .object({
    assignedToId: z
      .string({ error: "assignedToId must be a user id or null" })
      .trim()
      .min(1, "assignedToId must be a user id or null")
      .nullable()
      .optional(),
    status: z
      .enum(TicketStatus, { error: `status must be one of: ${Object.values(TicketStatus).join(", ")}` })
      .optional(),
    category: z
      .enum(TicketCategory, {
        error: `category must be one of: ${Object.values(TicketCategory).join(", ")}, or null`,
      })
      .nullable()
      .optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    error: "Provide at least one of assignedToId, status, category",
  });

export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;
