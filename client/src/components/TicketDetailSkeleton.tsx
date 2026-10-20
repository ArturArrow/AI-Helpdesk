import { Skeleton } from '@/components/ui/skeleton.tsx'

// Placeholder for the subject, details and body while the ticket loads.
function TicketDetailSkeleton() {
  return (
    <div aria-busy="true" className="space-y-4">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-32 w-full" />
    </div>
  )
}

export default TicketDetailSkeleton
