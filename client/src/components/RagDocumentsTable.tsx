import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import type { RagDocument } from 'core/constants/rag'
import DeleteRagDocumentDialog from '@/components/DeleteRagDocumentDialog.tsx'
import { Skeleton } from '@/components/ui/skeleton.tsx'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table.tsx'
import { errorMessage } from '@/lib/errorMessage.ts'
import { formatSize } from '@/lib/formatSize.ts'
import { ragDocumentsQueryKey } from '@/lib/rag.ts'

function RagDocumentsTable() {
  const { data: documents, error } = useQuery({
    queryKey: ragDocumentsQueryKey,
    queryFn: async () => {
      const res = await axios.get<{ documents: RagDocument[] }>('/api/rag/documents')
      return res.data.documents
    },
  })

  return error ? (
    <p role="alert" className="text-sm text-destructive">
      Couldn't load documents: {errorMessage(error)}
    </p>
  ) : documents?.length === 0 ? (
    <p className="text-muted-foreground">No documents yet.</p>
  ) : (
    <Table aria-busy={!documents}>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Size</TableHead>
          <TableHead>Chunks</TableHead>
          <TableHead>Added</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {documents
          ? documents.map((document) => (
              <TableRow key={document.id}>
                <TableCell className="font-medium wrap-break-word whitespace-normal">
                  {document.filename}
                </TableCell>
                <TableCell>{formatSize(document.size)}</TableCell>
                <TableCell>{document.chunkCount}</TableCell>
                <TableCell>{new Date(document.createdAt).toLocaleDateString()}</TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    <DeleteRagDocumentDialog document={document} />
                  </div>
                </TableCell>
              </TableRow>
            ))
          : Array.from({ length: 3 }, (_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                <TableCell><Skeleton className="h-4 w-14" /></TableCell>
                <TableCell><Skeleton className="h-4 w-8" /></TableCell>
                <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                <TableCell><Skeleton className="ml-auto h-7 w-7" /></TableCell>
              </TableRow>
            ))}
      </TableBody>
    </Table>
  )
}

export default RagDocumentsTable
