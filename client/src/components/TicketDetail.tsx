import DOMPurify from 'dompurify'
import type { TicketDetailData } from 'core/constants/ticket'
import { Card, CardContent } from '@/components/ui/card.tsx'

type TicketDetailProps = {
  ticket: Pick<TicketDetailData, 'senderName' | 'senderEmail' | 'createdAt' | 'body' | 'bodyHTML' | 'updatedAt'>
}

// The sender, timestamps and body of a ticket: the HTML body when there is one, otherwise the plain text.
// The HTML comes from the sender, so it is always sanitized before it is rendered.
function TicketDetail({ ticket }: TicketDetailProps) {
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
        {ticket.bodyHTML ? (
          <CardContent
            className="text-sm wrap-break-word"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(ticket.bodyHTML) }}
          />
        ) : (
          <CardContent className="text-sm wrap-break-word whitespace-pre-wrap">{ticket.body}</CardContent>
        )}
      </Card>
    </>
  )
}

export default TicketDetail
