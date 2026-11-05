import { MAX_CONTEXT_REPLIES, type TicketContext } from "./ai";
import { prisma } from "./db";

// The ticket and its latest MAX_CONTEXT_REPLIES replies (plain-text bodies, never bodyHTML),
// oldest first, as context for the AI features. null when the ticket doesn't exist.
export async function loadTicketContext(id: number): Promise<TicketContext | null> {
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    select: {
      subject: true,
      body: true,
      senderName: true,
      attachments: { select: { filename: true }, orderBy: { id: "asc" } },
      // The latest replies, newest first; reversed below to read oldest first.
      replies: {
        select: { body: true, sender: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: MAX_CONTEXT_REPLIES,
      },
    },
  });
  return (
    ticket && {
      ...ticket,
      attachments: ticket.attachments.map(({ filename }) => filename),
      replies: ticket.replies.reverse(),
    }
  );
}
