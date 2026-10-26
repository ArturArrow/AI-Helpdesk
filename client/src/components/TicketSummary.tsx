import { useMutation } from '@tanstack/react-query'
import axios from 'axios'
import type { TicketDetailData } from 'core/constants/ticket'
import { Loader2Icon, SparklesIcon } from 'lucide-react'
import { Button } from '@/components/ui/button.tsx'
import { Card, CardContent } from '@/components/ui/card.tsx'
import { errorMessage } from '@/lib/errorMessage.ts'

// An AI summary of the ticket and its replies. A mutation rather than a query: every click
// generates a fresh summary of the thread as it is now, and nothing is cached.
function TicketSummary({ ticket }: { ticket: Pick<TicketDetailData, 'id'> }) {
  const summarize = useMutation({
    mutationFn: async () => {
      const res = await axios.post<{ summary: string }>(`/api/tickets/${ticket.id}/summary`)
      return res.data.summary
    },
  })

  return (
    <section aria-label="Summary" className="space-y-3">
      <Button type="button" variant="outline" disabled={summarize.isPending} onClick={() => summarize.mutate()}>
        {summarize.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
        Summarize
      </Button>
      {summarize.error && (
        <p role="alert" className="text-sm text-destructive">
          Couldn't summarize the ticket: {errorMessage(summarize.error)}
        </p>
      )}
      {summarize.data && (
        <Card className="bg-muted">
          <CardContent className="text-sm wrap-break-word whitespace-pre-wrap">{summarize.data}</CardContent>
        </Card>
      )}
    </section>
  )
}

export default TicketSummary
