import { z } from "zod";

// Body of POST /api/tickets/:id/replies. The sender and author come from the session, never
// from the body.
export const createReplySchema = z.object({
  body: z
    .string({ error: "Reply can't be empty" })
    .trim()
    .min(1, "Reply can't be empty")
    .max(10_000, "Reply is too long"),
});

export type CreateReplyInput = z.infer<typeof createReplySchema>;
