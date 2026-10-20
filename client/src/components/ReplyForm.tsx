import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import type { TicketDetailData } from 'core/constants/ticket'
import { createReplySchema, type CreateReplyInput } from 'core/schemas/replies'
import { Loader2Icon } from 'lucide-react'
import { useForm } from 'react-hook-form'
import type { Reply } from '@/components/ReplyThread.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Label } from '@/components/ui/label.tsx'
import { Textarea } from '@/components/ui/textarea.tsx'
import { errorMessage } from '@/lib/errorMessage.ts'
import { repliesQueryKey } from '@/lib/replies.ts'

// Sends an agent's reply and adds it to the end of the ReplyThread list.
function ReplyForm({ ticket }: { ticket: Pick<TicketDetailData, 'id'> }) {
  const ticketId = String(ticket.id)
  const queryClient = useQueryClient()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateReplyInput>({
    resolver: zodResolver(createReplySchema),
    defaultValues: { body: '' },
  })

  const sendReply = useMutation({
    mutationFn: async (values: CreateReplyInput) => {
      const res = await axios.post<{ reply: Reply }>(`/api/tickets/${ticketId}/replies`, values)
      return res.data.reply
    },
    onSuccess: (reply) => {
      queryClient.setQueryData<Reply[]>(repliesQueryKey(ticketId), (replies) => [...(replies ?? []), reply])
      reset()
    },
  })

  return (
    <form onSubmit={handleSubmit((values) => sendReply.mutate(values))} noValidate className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="reply-body" className={errors.body ? 'text-destructive' : undefined}>
          Reply
        </Label>
        <Textarea
          id="reply-body"
          rows={4}
          aria-invalid={!!errors.body}
          {...register('body')}
        />
        {errors.body && (
          <p role="alert" className="text-sm text-destructive">
            {errors.body.message}
          </p>
        )}
      </div>
      {sendReply.error && (
        <p role="alert" className="text-sm text-destructive">
          Couldn't send the reply: {errorMessage(sendReply.error)}
        </p>
      )}
      <Button type="submit" disabled={sendReply.isPending}>
        {sendReply.isPending && <Loader2Icon className="animate-spin" />}
        Send reply
      </Button>
    </form>
  )
}

export default ReplyForm
