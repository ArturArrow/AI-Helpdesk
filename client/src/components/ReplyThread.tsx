import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { ReplySender, replySenderLabels } from 'core/constants/replySender'
import type { TicketDetailData } from '@/components/TicketDetail.tsx'
import { Card, CardContent } from '@/components/ui/card.tsx'
import { Skeleton } from '@/components/ui/skeleton.tsx'
import { errorMessage } from '@/lib/errorMessage.ts'
import { repliesQueryKey } from '@/lib/replies.ts'
import { cn } from '@/lib/utils.ts'

export type Reply = {
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
              <li key={reply.id} className={fromAgent ? 'sm:ml-12' : 'sm:mr-12'}>
                <Card className={cn(fromAgent && 'bg-muted')}>
                  <CardContent className="space-y-2 text-sm">
                    <p className="flex flex-wrap items-baseline gap-x-2">
                      {fromAgent && reply.author && <span className="font-medium">{reply.author.name}</span>}
                      <span className="text-muted-foreground">{replySenderLabels[reply.sender]}</span>
                      <span className="text-muted-foreground">·</span>
                      <time dateTime={reply.createdAt} className="text-muted-foreground">
                        {new Date(reply.createdAt).toLocaleString()}
                      </time>
                    </p>
                    <p className="wrap-break-word whitespace-pre-wrap">{reply.body}</p>
                  </CardContent>
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
