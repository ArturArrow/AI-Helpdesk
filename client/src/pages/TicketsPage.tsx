import { ticketListQuerySchema } from 'core/schemas/tickets'
import { useSearchParams } from 'react-router'
import TicketFilters, { type TicketFilterValues } from '@/components/TicketFilters.tsx'
import TicketsTable from '@/components/TicketsTable.tsx'

const filtersSchema = ticketListQuerySchema.pick({ status: true, category: true, q: true })

// Filters live in the URL (/tickets?status=open&category=unclassified&q=refund), so a filtered list
// can be linked to and survives a reload. An invalid value in the URL is ignored.
function TicketsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const parsed = filtersSchema.safeParse(Object.fromEntries(searchParams))
  const filters: TicketFilterValues = parsed.success ? parsed.data : {}

  function handleFiltersChange(next: TicketFilterValues) {
    // Searching replaces the history entry, so Back doesn't step through every pause in typing.
    const onlySearchChanged = next.status === filters.status && next.category === filters.category
    setSearchParams(
      (params) => {
        for (const key of ['status', 'category', 'q'] as const) {
          const value = next[key]
          if (value) params.set(key, value)
          else params.delete(key)
        }
        return params
      },
      { replace: onlySearchChanged },
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Tickets</h1>
        <TicketFilters filters={filters} onChange={handleFiltersChange} />
      </div>
      <TicketsTable filters={filters} />
    </div>
  )
}

export default TicketsPage
