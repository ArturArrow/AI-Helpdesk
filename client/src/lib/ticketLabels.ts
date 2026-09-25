import { TicketCategory } from 'core/constants/ticketCategory'
import { TicketStatus } from 'core/constants/ticketStatus'

export const statusLabels: Record<TicketStatus, string> = {
  [TicketStatus.open]: 'Open',
  [TicketStatus.resolved]: 'Resolved',
  [TicketStatus.closed]: 'Closed',
}

export const categoryLabels: Record<TicketCategory, string> = {
  [TicketCategory.general_question]: 'General question',
  [TicketCategory.technical_question]: 'Technical question',
  [TicketCategory.refund_request]: 'Refund request',
}
