// Limits on the files stored from an email. A file over them is listed by name but not stored,
// and the original stays in the mailbox. The webhook's JSON limit in server/src/index.ts must
// leave room for MAX_EMAIL_ATTACHMENT_BYTES as base64, which is a third larger.
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_EMAIL_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_STORED_ATTACHMENTS = 20;

// Limits on the files an agent sends with a reply; each is also under MAX_ATTACHMENT_BYTES. Lower
// than an inbound email's, since encoding adds a third and many mail servers refuse anything over
// 25 MB. The mailer's JSON limit on /send must leave room for this as base64.
export const MAX_REPLY_ATTACHMENT_BYTES = 18 * 1024 * 1024;
export const MAX_REPLY_ATTACHMENTS = 10;

// Image types shown inside an email's body. Everything else only downloads; SVG stays out
// because it can carry scripts.
export const INLINE_IMAGE_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

// A file as the ticket and reply endpoints list it, without its bytes.
export interface Attachment {
  id: number;
  filename: string;
  contentType: string;
  size: number;
  // What an inline image's cid: link in the email's HTML points at.
  contentId: string | null;
  // Over the limits, so listed by name only and not downloadable.
  tooLarge: boolean;
}
