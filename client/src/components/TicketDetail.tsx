import type { TicketDetailData } from 'core/constants/ticket'
import AttachmentList from '@/components/AttachmentList.tsx'
import { Card, CardContent } from '@/components/ui/card.tsx'
import { emailContent } from '@/lib/emailHtml.ts'

type TicketDetailProps = {
  ticket: Pick<
    TicketDetailData,
    'id' | 'senderName' | 'senderEmail' | 'createdAt' | 'body' | 'bodyHTML' | 'updatedAt' | 'attachments'
  >
}

// The sender, timestamps, body and files of a ticket: the HTML body when there is one, otherwise the
// plain text. emailContent sanitizes the HTML, which comes from the sender.
function TicketDetail({ ticket }: TicketDetailProps) {
  const { html, listed } = emailContent(ticket.bodyHTML, ticket.id, ticket.attachments)
  return (
    <>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">From</dt>
          <dd className="wrap-break-word">
            {ticket.senderName} &lt;{ticket.senderEmail}&gt;
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Created</dt>
          <dd>{new Date(ticket.createdAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Updated</dt>
          <dd>{new Date(ticket.updatedAt).toLocaleString()}</dd>
        </div>
      </dl>
      <Card>
        {html ? (
          <CardContent className="text-sm wrap-break-word" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <CardContent className="text-sm wrap-break-word whitespace-pre-wrap">{ticket.body}</CardContent>
        )}
        <AttachmentList ticketId={ticket.id} attachments={listed} />
      </Card>
    </>
  )
}

export default TicketDetail
