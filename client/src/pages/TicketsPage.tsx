import { ticketListQuerySchema } from 'core/schemas/tickets'
import { useSearchParams } from 'react-router'
import TicketFilters, { type TicketFilterValues } from '@/components/TicketFilters.tsx'
import TicketsTable, { type TicketSort } from '@/components/TicketsTable.tsx'

const filtersSchema = ticketListQuerySchema.pick({ status: true, category: true, q: true })
const sortSchema = ticketListQuerySchema.pick({ sortBy: true, sortOrder: true })
const pageSchema = ticketListQuerySchema.shape.page
const defaultSort = sortSchema.parse({})

// Filters, sort and page all live in the URL
// (/tickets?status=open&q=refund&sortBy=subject&sortOrder=asc&page=2), so a list can be linked
// to and survives a reload, and one navigation changes the sort and resets the page together.
// Each group is parsed on its own: an invalid value falls back to that group's default
// (no filters, newest first, page 1) without dropping the others. Defaults are left out of
// the URL.
function TicketsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const parsed = filtersSchema.safeParse(Object.fromEntries(searchParams))
  const filters: TicketFilterValues = parsed.success ? parsed.data : {}
  const parsedPage = pageSchema.safeParse(searchParams.get('page') ?? undefined)
  const page = parsedPage.success ? parsedPage.data : 1
  const parsedSort = sortSchema.safeParse(Object.fromEntries(searchParams))
  const sort: TicketSort = parsedSort.success ? parsedSort.data : defaultSort

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
        // Different filters, different result: start again from the first page.
        params.delete('page')
        return params
      },
      { replace: onlySearchChanged },
    )
  }

  function handleSortChange(next: TicketSort) {
    setSearchParams((params) => {
      for (const key of ['sortBy', 'sortOrder'] as const) {
        if (next[key] !== defaultSort[key]) params.set(key, next[key])
        else params.delete(key)
      }
      // A new order starts again from the first page.
      params.delete('page')
      return params
    })
  }

  function handlePageChange(next: number) {
    setSearchParams((params) => {
      if (next > 1) params.set('page', String(next))
      else params.delete('page')
      return params
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Tickets</h1>
        <TicketFilters filters={filters} onChange={handleFiltersChange} />
      </div>
      <TicketsTable
        filters={filters}
        sort={sort}
        onSortChange={handleSortChange}
        page={page}
        onPageChange={handlePageChange}
      />
    </div>
  )
}

export default TicketsPage
