import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import DOMPurify from 'dompurify'
import { EmailStatus, emailStatusLabels } from 'core/constants/emailStatus'
import { ReplySender, replySenderLabels } from 'core/constants/replySender'
import type { TicketDetailData } from 'core/constants/ticket'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card.tsx'
import { Skeleton } from '@/components/ui/skeleton.tsx'
import { errorMessage } from '@/lib/errorMessage.ts'
import { cn } from '@/lib/utils.ts'
import { repliesQueryKey } from '@/lib/replies.ts'

export interface Reply {
  id: number
  body: string
  // Null for agent replies, and for customer emails without an HTML part.
  bodyHTML: string | null
  sender: ReplySender
  // Whether an agent or AI reply was emailed to the customer. Null for customer replies, and for
  // replies stored while the server had no mailer.
  emailStatus: EmailStatus | null
  createdAt: string
  // Null for ReplySender.customer.
  author: { id: string; name: string } | null
}

// The ticket's replies, oldest first, as the API returns them.
function ReplyThread({ ticket }: { ticket: Pick<TicketDetailData, 'id'> }) {
  const ticketId = String(ticket.id)
  const { data: replies, error } = useQuery({
    queryKey: repliesQueryKey(ticketId),
    queryFn: async () => {
      const res = await axios.get<{ replies: Reply[] }>(`/api/tickets/${ticketId}/replies`)
      return res.data.replies
    },
    // Emails go out in the background, so a pending one is polled until it's sent or fails.
    refetchInterval: (query) =>
      query.state.data?.some((reply) => reply.emailStatus === EmailStatus.pending) ? 5000 : false,
  })

  return (
    <section aria-labelledby="replies-heading" className="space-y-3">
      <h2 id="replies-heading" className="text-lg font-semibold">
        Replies
      </h2>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          Couldn't load the replies: {errorMessage(error)}
        </p>
      ) : !replies ? (
        <div aria-busy="true" className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : replies.length === 0 ? (
        <p className="text-sm text-muted-foreground">No replies yet.</p>
      ) : (
        <ol className="space-y-3">
          {replies.map((reply) => {
            const fromAgent = reply.sender === ReplySender.agent
            return (
              <li key={reply.id}>
                <Card>
                  <CardHeader>
                    <CardDescription className="flex flex-wrap items-baseline gap-x-2">
                      {fromAgent && reply.author && (
                        <span className="font-medium text-foreground">{reply.author.name}</span>
                      )}
                      <span>{replySenderLabels[reply.sender]}</span>
                      <span>·</span>
                      <time dateTime={reply.createdAt}>{new Date(reply.createdAt).toLocaleString()}</time>
                      {reply.emailStatus && (
                        <>
                          <span>·</span>
                          <span className={cn(reply.emailStatus === EmailStatus.failed && 'text-destructive')}>
                            {emailStatusLabels[reply.emailStatus]}
                          </span>
                        </>
                      )}
                    </CardDescription>
                  </CardHeader>
                  {/* The HTML comes from the sender, so it is always sanitized before it is rendered. */}
                  {reply.bodyHTML ? (
                    <CardContent
                      className="text-sm wrap-break-word"
                      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(reply.bodyHTML) }}
                    />
                  ) : (
                    <CardContent className="text-sm wrap-break-word whitespace-pre-wrap">{reply.body}</CardContent>
                  )}
                </Card>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

export default ReplyThread
