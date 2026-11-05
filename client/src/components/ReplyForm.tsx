import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import {
  MAX_ATTACHMENT_BYTES,
  MAX_REPLY_ATTACHMENT_BYTES,
  MAX_REPLY_ATTACHMENTS,
} from 'core/constants/attachment'
import type { TicketDetailData } from 'core/constants/ticket'
import { createReplySchema, type CreateReplyInput } from 'core/schemas/replies'
import { Loader2Icon, PaperclipIcon, SparklesIcon, XIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import type { Reply } from '@/components/ReplyThread.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Label } from '@/components/ui/label.tsx'
import { Textarea } from '@/components/ui/textarea.tsx'
import { errorMessage } from '@/lib/errorMessage.ts'
import { formatSize } from '@/lib/formatSize.ts'
import { repliesQueryKey } from '@/lib/replies.ts'

// Why these files can't go with a reply, if they can't. The server checks the same limits, but this
// tells the agent before an upload that would fail.
function filesError(files: File[]) {
  const tooBig = files.find((file) => file.size > MAX_ATTACHMENT_BYTES)
  if (tooBig) return `${tooBig.name} is over the ${formatSize(MAX_ATTACHMENT_BYTES)} limit for a file.`
  if (files.length > MAX_REPLY_ATTACHMENTS) return `A reply can have at most ${MAX_REPLY_ATTACHMENTS} files.`
  if (files.reduce((total, file) => total + file.size, 0) > MAX_REPLY_ATTACHMENT_BYTES) {
    return `The files are over the ${formatSize(MAX_REPLY_ATTACHMENT_BYTES)} limit for a reply.`
  }
  return null
}

// Sends an agent's reply, with any files, and adds it to the end of the ReplyThread list.
function ReplyForm({ ticket }: { ticket: Pick<TicketDetailData, 'id'> }) {
  const ticketId = String(ticket.id)
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    reset,
    getValues,
    setValue,
    control,
    formState: { errors },
  } = useForm<CreateReplyInput>({
    resolver: zodResolver(createReplySchema),
    defaultValues: { body: '' },
  })

  const sendReply = useMutation({
    mutationFn: async (values: CreateReplyInput) => {
      const form = new FormData()
      form.append('body', values.body)
      for (const file of files) form.append('attachments', file)
      const res = await axios.post<{ reply: Reply }>(`/api/tickets/${ticketId}/replies`, form)
      return res.data.reply
    },
    onSuccess: (reply) => {
      queryClient.setQueryData<Reply[]>(repliesQueryKey(ticketId), (replies) => [...(replies ?? []), reply])
      reset()
      setFiles([])
      setFileError(null)
    },
  })

  // A choice that breaks a limit is dropped whole, and the files already chosen stay.
  function addFiles(chosen: File[]) {
    const next = [...files, ...chosen]
    const error = filesError(next)
    setFileError(error)
    if (!error) setFiles(next)
  }

  // Replaces the draft with an AI-polished version for the agent to review before sending.
  const polishReply = useMutation({
    mutationFn: async (body: string) => {
      const res = await axios.post<{ body: string }>(`/api/tickets/${ticketId}/replies/polish`, { body })
      return res.data.body
    },
    onSuccess: (body) => setValue('body', body, { shouldValidate: true, shouldDirty: true }),
  })

  const isPending = sendReply.isPending || polishReply.isPending
  // Sending or polishing a blank reply is blocked by disabling the buttons, not by a validation error.
  const isBlank = !useWatch({ control, name: 'body' }).trim()

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
          onKeyDown={(e) => {
            // Cmd+Enter (Ctrl+Enter off macOS) sends, like clicking "Send reply".
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !isPending && !isBlank) {
              e.preventDefault()
              e.currentTarget.form?.requestSubmit()
            }
          }}
        />
        {errors.body && (
          <p role="alert" className="text-sm text-destructive">
            {errors.body.message}
          </p>
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        aria-label="Files to attach"
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []))
          // Cleared, so choosing a removed file again fires a change.
          e.target.value = ''
        }}
      />
      {files.length > 0 && (
        <ul aria-label="Files to send" className="space-y-1 text-sm">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex items-center gap-1 wrap-break-word">
              <span>
                {file.name} <span className="text-muted-foreground">({formatSize(file.size)})</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove ${file.name}`}
                disabled={isPending}
                onClick={() => {
                  setFiles(files.filter((_, i) => i !== index))
                  setFileError(null)
                }}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {fileError && (
        <p role="alert" className="text-sm text-destructive">
          {fileError}
        </p>
      )}
      {sendReply.error && (
        <p role="alert" className="text-sm text-destructive">
          Couldn't send the reply: {errorMessage(sendReply.error)}
        </p>
      )}
      {polishReply.error && (
        <p role="alert" className="text-sm text-destructive">
          Couldn't polish the reply: {errorMessage(polishReply.error)}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={isPending || isBlank}>
          {sendReply.isPending && <Loader2Icon className="animate-spin" />}
          Send reply
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={isPending || isBlank}
          onClick={() => polishReply.mutate(getValues('body'))}
        >
          {polishReply.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
          Polish
        </Button>
        <Button type="button" variant="outline" disabled={isPending} onClick={() => fileInput.current?.click()}>
          <PaperclipIcon />
          Attach files
        </Button>
      </div>
    </form>
  )
}

export default ReplyForm
