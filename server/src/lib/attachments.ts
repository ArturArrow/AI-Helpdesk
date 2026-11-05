import type { z } from "zod";
import type { inboundEmailSchema } from "core/schemas/tickets";

type InboundAttachment = NonNullable<z.output<typeof inboundEmailSchema>["attachments"]>[number];

// What the endpoints return for a file. Never add data: a ticket's files can be 25 MB.
export const attachmentSelect = {
  id: true,
  filename: true,
  contentType: true,
  size: true,
  contentId: true,
  tooLarge: true,
} as const;

// The webhook's files as database rows. A file without content is one over the limits, so it keeps
// the size the sender reported; a stored one's size comes from its bytes.
export function toAttachmentRows(attachments: InboundAttachment[]) {
  return attachments.map(({ content, size, ...attachment }) => {
    if (content === undefined) return { ...attachment, size, tooLarge: true };
    const data = Buffer.from(content, "base64");
    return { ...attachment, size: data.length, data };
  });
}
