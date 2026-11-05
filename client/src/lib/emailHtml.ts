import DOMPurify from 'dompurify'
import { type Attachment, INLINE_IMAGE_TYPES } from 'core/constants/attachment'

export function attachmentUrl(ticketId: number, attachmentId: number) {
  return `/api/tickets/${ticketId}/attachments/${attachmentId}`
}

// An email's HTML, ready to render, and the files left to list under it. The HTML comes from the
// sender, so it is always sanitized here. Inline images point at their files through cid: links,
// rewritten to the download URL after sanitizing, from ids of our own. A file shown that way isn't
// listed as well, so signature logos don't clutter the list.
export function emailContent(bodyHTML: string | null, ticketId: number, attachments: Attachment[]) {
  if (!bodyHTML) return { html: null, listed: attachments }

  // Keyed on the escaped form too: RFC 2392 URL-encodes the id in a cid: link.
  const images = new Map<string, Attachment>()
  for (const attachment of attachments) {
    if (attachment.contentId && !attachment.tooLarge && INLINE_IMAGE_TYPES.includes(attachment.contentType)) {
      images.set(attachment.contentId, attachment)
      images.set(encodeURIComponent(attachment.contentId), attachment)
    }
  }

  // Typed as Node, but RETURN_DOM gives the <body> holding the sanitized HTML.
  const body = DOMPurify.sanitize(bodyHTML, { RETURN_DOM: true }) as HTMLElement
  const embedded = new Set<Attachment>()
  for (const img of body.querySelectorAll('img[src^="cid:" i]')) {
    const image = images.get(img.getAttribute('src')!.slice('cid:'.length))
    if (!image) continue
    img.setAttribute('src', attachmentUrl(ticketId, image.id))
    embedded.add(image)
  }
  return { html: body.innerHTML, listed: attachments.filter((attachment) => !embedded.has(attachment)) }
}
