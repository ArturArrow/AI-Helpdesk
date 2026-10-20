import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { useParams } from 'react-router'
import BackLink from '@/components/BackLink.tsx'
import ReplyForm from '@/components/ReplyForm.tsx'
import ReplyThread from '@/components/ReplyThread.tsx'
import TicketDetail, { type TicketDetailData } from '@/components/TicketDetail.tsx'
import TicketDetailSkeleton from '@/components/TicketDetailSkeleton.tsx'
import UpdateTicket from '@/components/UpdateTicket.tsx'
import { errorMessage } from '@/lib/errorMessage.ts'

function TicketDetailPage() {
  const { id } = useParams()

  const { data: ticket, error, isLoading } = useQuery({
    queryKey: ['ticket', id],
    queryFn: async () => {
      const res = await axios.get<{ ticket: TicketDetailData }>(`/api/tickets/${id}`)
      return res.data.ticket
    },
  })

  return (
    <div className="space-y-6">
      <BackLink to="/tickets">Back to tickets</BackLink>
      
      {isLoading && <TicketDetailSkeleton />}

      {error &&
        (axios.isAxiosError(error) && error.response?.status === 404 ? (
          <p className="text-muted-foreground">Ticket not found.</p>
        ) : (
          <p role="alert" className="text-sm text-destructive">
            Couldn't load the ticket: {errorMessage(error)}
          </p>
        ))}

      {ticket && (
        <>
          <h1 className="text-2xl font-semibold wrap-break-word">{ticket.subject}</h1>
          <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
            <div className="min-w-0 space-y-6">
              <TicketDetail ticket={ticket} />
              <ReplyThread ticket={ticket} />
              <ReplyForm ticket={ticket} />
            </div>
            <aside aria-label="Ticket properties" className="space-y-4">
              <UpdateTicket ticket={ticket} />
            </aside>
          </div>
        </>
      )}
    </div>
  )
}

export default TicketDetailPage
