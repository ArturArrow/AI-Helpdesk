import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import type { Assignee, TicketDetailData } from 'core/constants/ticket'
import { categoryLabels, TicketCategory } from 'core/constants/ticketCategory'
import { statusLabels, TicketStatus } from 'core/constants/ticketStatus'
import type { UpdateTicketInput } from 'core/schemas/tickets'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx'
import { errorMessage } from '@/lib/errorMessage.ts'

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

// The ticket's assignee, status and category, each saved as soon as it changes.
function UpdateTicket({ ticket }: { ticket: TicketDetailData }) {
  const queryClient = useQueryClient()
  const update = useMutation({
    mutationFn: async (changes: UpdateTicketInput) => {
      const res = await axios.patch<{ ticket: TicketDetailData }>(`/api/tickets/${ticket.id}`, changes)
      return res.data.ticket
    },
    onSuccess: (updated) => queryClient.setQueryData(['ticket', String(ticket.id)], updated),
  })

  return (
    <>
      <dl className="space-y-4 text-sm">
        <div className="space-y-1">
          <dt className="text-muted-foreground">Assigned to</dt>
          <dd>
            <AssigneeSelect
              assignedTo={ticket.assignedTo}
              disabled={update.isPending}
              onChange={(assignedToId) => update.mutate({ assignedToId })}
            />
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-muted-foreground">Status</dt>
          <dd>
            <Select<TicketStatus>
              items={statusItems}
              value={ticket.status}
              onValueChange={(status) => status && update.mutate({ status })}
              disabled={update.isPending}
            >
              <SelectTrigger aria-label="Status" className="w-full">
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
        <div className="space-y-1">
          <dt className="text-muted-foreground">Category</dt>
          <dd>
            <Select<TicketCategory>
              items={categoryItems}
              value={ticket.category}
              onValueChange={(category) => update.mutate({ category })}
              disabled={update.isPending}
            >
              <SelectTrigger aria-label="Category" className="w-full">
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
      </dl>
      {update.error && (
        <p role="alert" className="text-sm text-destructive">
          Couldn't update the ticket: {errorMessage(update.error)}
        </p>
      )}
    </>
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
        <SelectTrigger aria-label="Assigned to" className="w-full">
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

export default UpdateTicket
