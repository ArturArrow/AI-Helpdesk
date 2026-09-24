import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { TicketCategory } from 'core/constants/ticketCategory'
import { TicketStatus } from 'core/constants/ticketStatus'
import { Skeleton } from '@/components/ui/skeleton.tsx'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table.tsx'

export type Ticket = {
  id: number
  subject: string
  senderName: string
  senderEmail: string
  status: TicketStatus
  category: TicketCategory | null
  createdAt: string
}

const categoryLabels: Record<TicketCategory, string> = {
  [TicketCategory.general_question]: 'General question',
  [TicketCategory.technical_question]: 'Technical question',
  [TicketCategory.refund_request]: 'Refund request',
}

// The server returns tickets newest first; the table keeps that order.
function TicketsTable() {
  const { data: tickets, error } = useQuery({
    queryKey: ['tickets'],
    queryFn: async () => {
      const res = await axios.get<{ tickets: Ticket[] }>('/api/tickets')
      return res.data.tickets
    },
  })

  return error ? (
    <p role="alert" className="text-sm text-destructive">
      Couldn't load tickets: {errorMessage(error)}
    </p>
  ) : tickets?.length === 0 ? (
    <p className="text-muted-foreground">No tickets yet.</p>
  ) : (
    <Table aria-busy={!tickets}>
      <TableHeader>
        <TableRow>
          <TableHead>Subject</TableHead>
          <TableHead>From</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tickets
          ? tickets.map((ticket) => (
              <TableRow key={ticket.id}>
                <TableCell className="max-w-80 truncate font-medium">{ticket.subject}</TableCell>
                <TableCell>
                  <div>{ticket.senderName}</div>
                  <div className="text-muted-foreground">{ticket.senderEmail}</div>
                </TableCell>
                <TableCell className="capitalize">{ticket.status}</TableCell>
                <TableCell>
                  {ticket.category ? (
                    categoryLabels[ticket.category]
                  ) : (
                    <span className="text-muted-foreground">Unclassified</span>
                  )}
                </TableCell>
                <TableCell>{new Date(ticket.createdAt).toLocaleString()}</TableCell>
              </TableRow>
            ))
          : Array.from({ length: 3 }, (_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-4 w-56" /></TableCell>
                <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                <TableCell><Skeleton className="h-4 w-14" /></TableCell>
                <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                <TableCell><Skeleton className="h-4 w-32" /></TableCell>
              </TableRow>
            ))}
      </TableBody>
    </Table>
  )
}

function errorMessage(error: Error) {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined
  return status ? `Request failed (${status})` : 'Request failed'
}

export default TicketsTable
