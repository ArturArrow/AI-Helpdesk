import { useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { MAX_RAG_DOCUMENT_BYTES, RAG_DOCUMENT_EXTENSIONS, type RagDocument } from 'core/constants/rag'
import { Loader2Icon, UploadIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button.tsx'
import { formatSize } from '@/lib/formatSize.ts'
import { ragDocumentsQueryKey } from '@/lib/rag.ts'

// Why this file can't be added, if it can't. The rag service checks the same, but this answers
// before a large file is sent.
function fileError(file: File) {
  const name = file.name.toLowerCase()
  if (!RAG_DOCUMENT_EXTENSIONS.some((extension) => name.endsWith(extension))) {
    return 'Only PDF and TXT files can be added.'
  }
  if (file.size > MAX_RAG_DOCUMENT_BYTES) {
    return `${file.name} is over the ${formatSize(MAX_RAG_DOCUMENT_BYTES)} limit.`
  }
  return null
}

// Adds a document as soon as it's chosen and puts it at the top of the list, which is newest first.
function UploadRagDocument() {
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [chosenError, setChosenError] = useState<string | null>(null)

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      const res = await axios.post<{ document: RagDocument }>('/api/rag/documents', form)
      return res.data.document
    },
    onSuccess: (document) => {
      queryClient.setQueryData<RagDocument[]>(ragDocumentsQueryKey, (documents) =>
        documents ? [document, ...documents] : documents,
      )
    },
  })

  function choose(file: File | undefined) {
    if (!file) return
    upload.reset()
    const error = fileError(file)
    setChosenError(error)
    if (!error) upload.mutate(file)
  }

  // The server's message says what to fix (a name in use, a scanned PDF), so it's shown as is.
  const uploadError = upload.error
    ? ((axios.isAxiosError(upload.error) ? upload.error.response?.data?.error : undefined) ??
      "Couldn't add the document.")
    : null
  const error = chosenError ?? uploadError

  return (
    <div className="flex flex-col items-end gap-2">
      <input
        ref={fileInput}
        type="file"
        accept={RAG_DOCUMENT_EXTENSIONS.join(',')}
        className="hidden"
        aria-label="Document to add"
        onChange={(e) => {
          choose(e.target.files?.[0])
          // Cleared, so choosing the same file again fires a change.
          e.target.value = ''
        }}
      />
      <Button disabled={upload.isPending} onClick={() => fileInput.current?.click()}>
        {upload.isPending ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
        {upload.isPending ? 'Indexing…' : 'Add document'}
      </Button>
      {upload.isPending && (
        <p className="text-sm text-muted-foreground">A long PDF can take a minute.</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

export default UploadRagDocument
