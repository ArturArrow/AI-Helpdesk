import RagDocumentsTable from '@/components/RagDocumentsTable.tsx'

// The documents the AI answers new tickets from. Admin-only, like what's in them.
function RagPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Knowledge base</h1>
        <p className="text-sm text-muted-foreground">
          The AI answers new tickets from these documents.
        </p>
      </div>
      <RagDocumentsTable />
    </div>
  )
}

export default RagPage
