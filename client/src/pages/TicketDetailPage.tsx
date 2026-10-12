import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { TicketCategory } from 'core/constants/ticketCategory'
import { TicketStatus } from 'core/constants/ticketStatus'
import type { UpdateTicketInput } from 'core/schemas/tickets'
import { ArrowLeft } from 'lucide-react'
import { Link, useLocation, useParams } from 'react-router'
import type { Ticket } from '@/components/TicketsTable.tsx'
import { Card, CardContent } from '@/components/ui/card.tsx'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx'
import { Skeleton } from '@/components/ui/skeleton.tsx'
import { errorMessage } from '@/lib/errorMessage.ts'
import { categoryLabels, statusLabels } from '@/lib/ticketLabels.ts'

type Assignee = { id: string; name: string }

type TicketDetail = Ticket & {
  body: string
  updatedAt: string
  assignedTo: Assignee | null
}

const statusItems = Object.values(TicketStatus).map((status) => ({
  value: status,
  label: statusLabels[status],
}))

// A null item marks the ticket unclassified again.
const categoryItems: { value: TicketCategory | null; label: string }[] = [
  { value: null, label: 'Unclassified' },
  ...Object.values(TicketCategory).map((category) => ({
    value: category,
    label: categoryLabels[category],
  })),
]

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

  const queryClient = useQueryClient()
  const update = useMutation({
    mutationFn: async (changes: UpdateTicketInput) => {
      const res = await axios.patch<{ ticket: TicketDetail }>(`/api/tickets/${id}`, changes)
      return res.data.ticket
    },
    onSuccess: (updated) => queryClient.setQueryData(['ticket', id], updated),
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
          <h1 className="text-2xl font-semibold wrap-break-word">{ticket.subject}</h1>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">From</dt>
              <dd>
                {ticket.senderName} &lt;{ticket.senderEmail}&gt;
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Assigned to</dt>
              <dd>
                <AssigneeSelect
                  assignedTo={ticket.assignedTo}
                  disabled={update.isPending}
                  onChange={(assignedToId) => update.mutate({ assignedToId })}
                />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <Select<TicketStatus>
                  items={statusItems}
                  value={ticket.status}
                  onValueChange={(status) => status && update.mutate({ status })}
                  disabled={update.isPending}
                >
                  <SelectTrigger aria-label="Status" className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statusItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Category</dt>
              <dd>
                <Select<TicketCategory>
                  items={categoryItems}
                  value={ticket.category}
                  onValueChange={(category) => update.mutate({ category })}
                  disabled={update.isPending}
                >
                  <SelectTrigger aria-label="Category" className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryItems.map((item) => (
                      <SelectItem key={item.value ?? ''} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
          {update.error && (
            <p role="alert" className="text-sm text-destructive">
              Couldn't update the ticket: {errorMessage(update.error)}
            </p>
          )}
          <Card>
            <CardContent className="text-sm wrap-break-word whitespace-pre-wrap">{ticket.body}</CardContent>
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

// Picks the agent a ticket is assigned to; a null item unassigns it.
function AssigneeSelect({
  assignedTo,
  disabled,
  onChange,
}: {
  assignedTo: Assignee | null
  disabled: boolean
  onChange: (assignedToId: string | null) => void
}) {
  const { data: agents, error } = useQuery({
    queryKey: ['assignees'],
    queryFn: async () => {
      const res = await axios.get<{ agents: Assignee[] }>('/api/tickets/assignees')
      return res.data.agents
    },
  })

  // A soft-deleted agent isn't in the list but can still hold the ticket, so keep them
  // selectable as the current value rather than showing a bare id.
  const options =
    assignedTo && !agents?.some((agent) => agent.id === assignedTo.id)
      ? [assignedTo, ...(agents ?? [])]
      : (agents ?? [])
  const items: { value: string | null; label: string }[] = [
    { value: null, label: 'Unassigned' },
    ...options.map((agent) => ({ value: agent.id, label: agent.name })),
  ]

  return (
    <div className="space-y-1">
      <Select<string>
        items={items}
        value={assignedTo?.id ?? null}
        onValueChange={onChange}
        disabled={!agents || disabled}
      >
        <SelectTrigger aria-label="Assigned to" className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value ?? ''} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          Couldn't load agents: {errorMessage(error)}
        </p>
      )}
    </div>
  )
}

export default TicketDetailPage
