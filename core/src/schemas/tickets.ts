import { z } from "zod";
import { TicketCategory } from "../constants/ticketCategory";
import { VISIBLE_TICKET_STATUSES } from "../constants/ticketStatus";

// Body of POST /api/webhooks/inbound-email. Provider-neutral: a SendGrid/Mailgun adapter
// (or a forwarding script) maps its own format onto this.
// 998 is the RFC 5322 line-length limit for a header; 254 the RFC 5321 limit for an address.
// The body caps stop abuse; the webhook's own 1 MB JSON limit leaves room for both.
export const inboundEmailSchema = z.object({
  senderEmail: z
    .string({ error: "senderEmail is required" })
    .trim()
    .toLowerCase()
    .max(254, "senderEmail is too long")
    .pipe(z.email("senderEmail must be a valid email address")),
  senderName: z
    .string({ error: "senderName is required" })
    .trim()
    .min(1, "senderName is required")
    .max(998, "senderName is too long"),
  subject: z
    .string()
    .trim()
    .max(998, "subject is too long")
    .optional()
    .transform((subject) => subject || "(no subject)"),
  body: z
    .string({ error: "body is required" })
    .trim()
    .min(1, "body is required")
    .max(50_000, "body is too long"),
  bodyHTML: z.string().max(100_000, "bodyHTML is too long").optional(),
  messageId: z.string().trim().min(1).max(998, "messageId is too long").optional(),
  // Threading headers: In-Reply-To and the Message-IDs listed in References. An email that
  // points at a known ticket or customer reply is stored as a reply on that ticket.
  inReplyTo: z.string().trim().min(1).max(998, "inReplyTo is too long").optional(),
  references: z
    .array(z.string().trim().min(1).max(998, "references entry is too long"), {
      error: "references must be an array of Message-IDs",
    })
    .max(100, "references has too many entries")
    .optional(),
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
    .enum(VISIBLE_TICKET_STATUSES, { error: `status must be one of: ${VISIBLE_TICKET_STATUSES.join(", ")}` })
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

// Query of GET /api/tickets/stats: the dashboard counts tickets created in the last N calendar
// days (today included), or all. Days are counted in tz, the viewer's IANA time zone.
export const statsPeriods = ["7d", "30d", "90d", "all"] as const;
export type StatsPeriod = (typeof statsPeriods)[number];

export const statsPeriodDays: Record<Exclude<StatsPeriod, "all">, number> = { "7d": 7, "30d": 30, "90d": 90 };

export const statsPeriodLabels: Record<StatsPeriod, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
};

// A named zone. Intl also accepts offsets like "+09:00", but Postgres reads those as POSIX zones,
// where positive means west of UTC, so they'd put tickets on the wrong day.
function isTimeZone(tz: string) {
  try {
    return !/^[+-]/.test(new Intl.DateTimeFormat("en", { timeZone: tz }).resolvedOptions().timeZone);
  } catch {
    return false;
  }
}

export const ticketStatsQuerySchema = z.object({
  period: z.enum(statsPeriods, { error: `period must be one of: ${statsPeriods.join(", ")}` }).default("all"),
  tz: z
    .string({ error: "tz must be a time zone" })
    .max(64, "tz must be a time zone")
    .refine(isTimeZone, "tz must be a time zone")
    .default("UTC"),
});

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
      .enum(VISIBLE_TICKET_STATUSES, { error: `status must be one of: ${VISIBLE_TICKET_STATUSES.join(", ")}` })
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
