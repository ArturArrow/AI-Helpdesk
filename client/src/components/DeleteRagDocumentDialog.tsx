import { useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import type { RagDocument } from 'core/constants/rag'
import { AlertCircleIcon, Loader2Icon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert.tsx'
import { Button } from '@/components/ui/button.tsx'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog.tsx'
import { ragDocumentsQueryKey } from '@/lib/rag.ts'

function DeleteRagDocumentDialog({ document }: { document: RagDocument }) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()

  const deleteDocument = useMutation({
    mutationFn: () => axios.delete(`/api/rag/documents/${document.id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ragDocumentsQueryKey })
      setOpen(false)
    },
  })

  function onOpenChange(next: boolean) {
    setOpen(next)
    // Each opening starts without the last attempt's error.
    if (next) deleteDocument.reset()
  }

  const error = deleteDocument.error
  const errorMessage =
    (axios.isAxiosError(error) ? error.response?.data?.error : undefined) ??
    "Couldn't delete the document"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={`Delete ${document.filename}`} />}
      >
        <Trash2Icon />
      </DialogTrigger>

      <DialogContent className="flex flex-col gap-5">
        <DialogHeader>
          <DialogTitle>Delete document</DialogTitle>
          <DialogDescription>
            Delete {document.filename}? The AI will no longer answer tickets from it.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            variant="destructive"
            disabled={deleteDocument.isPending}
            onClick={() => deleteDocument.mutate()}
          >
            {deleteDocument.isPending && <Loader2Icon className="animate-spin" />}
            {deleteDocument.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default DeleteRagDocumentDialog
