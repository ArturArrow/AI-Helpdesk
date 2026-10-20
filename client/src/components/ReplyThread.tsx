import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { ReplySender, replySenderLabels } from 'core/constants/replySender'
import type { TicketDetailData } from 'core/constants/ticket'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card.tsx'
import { Skeleton } from '@/components/ui/skeleton.tsx'
import { errorMessage } from '@/lib/errorMessage.ts'
import { repliesQueryKey } from '@/lib/replies.ts'

export interface Reply {
  id: number
  body: string
  sender: ReplySender
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
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="text-sm wrap-break-word whitespace-pre-wrap">{reply.body}</CardContent>
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
