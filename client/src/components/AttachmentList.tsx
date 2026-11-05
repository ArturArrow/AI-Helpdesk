import type { Attachment } from 'core/constants/attachment'
import { CardContent } from '@/components/ui/card.tsx'
import { attachmentUrl } from '@/lib/emailHtml.ts'

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

type AttachmentListProps = {
  ticketId: number
  attachments: Attachment[]
}

// The files of an email, inside its card. One over the size limits has no file to download: only
// the original email in the mailbox holds it.
function AttachmentList({ ticketId, attachments }: AttachmentListProps) {
  if (attachments.length === 0) return null
  return (
    <CardContent>
      <ul aria-label="Attachments" className="space-y-1 border-t pt-3 text-sm">
        {attachments.map((attachment) => (
          <li key={attachment.id} className="wrap-break-word">
            {attachment.tooLarge ? (
              attachment.filename
            ) : (
              <a href={attachmentUrl(ticketId, attachment.id)} className="underline underline-offset-2">
                {attachment.filename}
              </a>
            )}{' '}
            <span className="text-muted-foreground">
              ({formatSize(attachment.size)}
              {attachment.tooLarge && ', too large, not stored'})
            </span>
          </li>
        ))}
      </ul>
    </CardContent>
  )
}

export default AttachmentList
