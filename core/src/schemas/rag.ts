import { z } from "zod";

export const ragDocumentParamsSchema = z.object({
  id: z.uuid({ error: "id must be a UUID" }),
});
