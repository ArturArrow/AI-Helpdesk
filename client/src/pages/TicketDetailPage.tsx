import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { ArrowLeft } from 'lucide-react'
import { Link, useLocation, useParams } from 'react-router'
import type { Ticket } from '@/components/TicketsTable.tsx'
import { Card, CardContent } from '@/components/ui/card.tsx'
import { Skeleton } from '@/components/ui/skeleton.tsx'
import { errorMessage } from '@/lib/errorMessage.ts'
import { categoryLabels, statusLabels } from '@/lib/ticketLabels.ts'

type TicketDetail = Ticket & {
  body: string
  updatedAt: string
  assignedTo: { id: string; name: string } | null
}

function TicketDetailPage() {
  const { id } = useParams()
  const location = useLocation()
  // The list passes its own URL, so Back keeps its filters, sort and page.
  const backTo = (location.state as { from?: string } | null)?.from ?? '/tickets'

  const { data: ticket, error } = useQuery({
    queryKey: ['ticket', id],
    queryFn: async () => {
      const res = await axios.get<{ ticket: TicketDetail }>(`/api/tickets/${id}`)
      return res.data.ticket
    },
  })

  return (
    <div className="space-y-6">
      <Link
        to={backTo}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to tickets
      </Link>
      {error ? (
        axios.isAxiosError(error) && error.response?.status === 404 ? (
          <p className="text-muted-foreground">Ticket not found.</p>
        ) : (
          <p role="alert" className="text-sm text-destructive">
            Couldn't load the ticket: {errorMessage(error)}
          </p>
        )
      ) : ticket ? (
        <>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold break-words">{ticket.subject}</h1>
            <p className="text-sm">
              {statusLabels[ticket.status]} ·{' '}
              {ticket.category ? (
                categoryLabels[ticket.category]
              ) : (
                <span className="text-muted-foreground">Unclassified</span>
              )}
            </p>
          </div>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">From</dt>
              <dd>
                {ticket.senderName} &lt;{ticket.senderEmail}&gt;
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Assigned to</dt>
              <dd>{ticket.assignedTo?.name ?? 'Unassigned'}</dd>
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
            <CardContent className="text-sm break-words whitespace-pre-wrap">{ticket.body}</CardContent>
          </Card>
        </>
      ) : (
        <div aria-busy="true" className="space-y-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}
    </div>
  )
}

export default TicketDetailPage
