// Query key of a ticket's replies: ReplyThread reads it, ReplyForm adds a sent reply to it.
export const repliesQueryKey = (ticketId: string) => ['ticket', ticketId, 'replies']
