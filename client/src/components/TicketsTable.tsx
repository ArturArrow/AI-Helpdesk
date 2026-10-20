import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  createColumnHelper,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type SortingState,
} from '@tanstack/react-table'
import axios from 'axios'
import type { Ticket } from 'core/constants/ticket'
import { categoryLabels } from 'core/constants/ticketCategory'
import {
  DEFAULT_TICKET_PAGE_SIZE,
  type TicketListQuery,
  type TicketSortField,
} from 'core/schemas/tickets'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { Link, useLocation } from 'react-router'
import type { TicketFilterValues } from '@/components/TicketFilters.tsx'
import { Button } from '@/components/ui/button.tsx'
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

const features = tableFeatures({ rowSortingFeature })
const columnHelper = createColumnHelper<typeof features, Ticket>()

// Column ids double as the server's sortBy values (ticketSortFields in core).
const columns = columnHelper.columns([
  columnHelper.accessor('subject', {
    header: 'Subject',
    cell: ({ row }) => <TicketSubjectLink ticket={row.original} />,
  }),
  columnHelper.accessor('senderName', {
    header: 'From',
    cell: ({ row }) => (
      <>
        <div>{row.original.senderName}</div>
        <div className="text-muted-foreground">{row.original.senderEmail}</div>
      </>
    ),
  }),
  columnHelper.accessor('status', {
    header: 'Status',
    cell: ({ getValue }) => <span className="capitalize">{getValue()}</span>,
  }),
  columnHelper.accessor('category', {
    header: 'Category',
    cell: ({ getValue }) => {
      const category = getValue()
      return category ? (
        categoryLabels[category]
      ) : (
        <span className="text-muted-foreground">Unclassified</span>
      )
    },
  }),
  columnHelper.accessor('createdAt', {
    header: 'Created',
    sortDescFirst: true,
    cell: ({ getValue }) => new Date(getValue()).toLocaleString(),
  }),
])

// Passes the list's URL along, so the detail page's back link returns to the same filters,
// sort and page.
function TicketSubjectLink({ ticket }: { ticket: Ticket }) {
  const location = useLocation()
  return (
    <Link
      to={`/tickets/${ticket.id}`}
      state={{ from: location.pathname + location.search }}
      className="block max-w-80 truncate font-medium hover:underline"
    >
      {ticket.subject}
    </Link>
  )
}

const skeletonWidths = ['w-56', 'w-40', 'w-14', 'w-28', 'w-32']

const PAGE_SIZE = DEFAULT_TICKET_PAGE_SIZE

export type TicketSort = Pick<TicketListQuery, 'sortBy' | 'sortOrder'>

type TicketsTableProps = {
  filters: TicketFilterValues
  sort: TicketSort
  onSortChange: (sort: TicketSort) => void
  page: number
  onPageChange: (page: number) => void
}

// Sorting, filtering and paging happen on the server. The table is controlled: the sort and
// the page come from the URL (TicketsPage), and it renders the page of rows the API returns,
// in its order.
function TicketsTable({ filters, sort, onSortChange, page, onPageChange }: TicketsTableProps) {
  const sorting: SortingState = [{ id: sort.sortBy, desc: sort.sortOrder === 'desc' }]
  const params: TicketListQuery = { ...sort, ...filters, page, pageSize: PAGE_SIZE }

  const { data, error, isPlaceholderData } = useQuery({
    queryKey: ['tickets', params],
    queryFn: async () => {
      const res = await axios.get<{ tickets: Ticket[]; total: number }>('/api/tickets', { params })
      // Remember which page this is, so while the next one loads the footer still describes
      // the rows on screen.
      return { ...res.data, page }
    },
    // Keep the current rows on screen while a re-sort or another page loads.
    placeholderData: keepPreviousData,
  })
  const tickets = data?.tickets

  const table = useTable({
    features,
    columns,
    data: tickets ?? [],
    state: { sorting },
    onSortingChange: (updater) => {
      const [next] = typeof updater === 'function' ? updater(sorting) : updater
      if (next) onSortChange({ sortBy: next.id as TicketSortField, sortOrder: next.desc ? 'desc' : 'asc' })
    },
    manualSorting: true,
    enableMultiSort: false,
    enableSortingRemoval: false,
    sortDescFirst: false,
  })

  return error ? (
    <p role="alert" className="text-sm text-destructive">
      Couldn't load tickets: {errorMessage(error)}
    </p>
  ) : data?.total === 0 ? (
    <p className="text-muted-foreground">
      {filters.status || filters.category || filters.q
        ? 'No tickets match these filters.'
        : 'No tickets yet.'}
    </p>
  ) : tickets?.length === 0 ? (
    // A page past the end, e.g. from an old link after tickets were closed.
    <div className="flex items-center gap-3">
      <p className="text-muted-foreground">No tickets on this page.</p>
      <Button variant="outline" size="sm" onClick={() => onPageChange(1)}>
        Go to first page
      </Button>
    </div>
  ) : (
    <div className="space-y-4">
      <Table aria-busy={!tickets || isPlaceholderData}>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const sorted = header.column.getIsSorted()
                const SortIcon = sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ArrowUpDown
                return (
                  <TableHead
                    key={header.id}
                    aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-ml-2.5"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <table.FlexRender header={header} />
                      <SortIcon aria-hidden="true" className={sorted ? '' : 'text-muted-foreground'} />
                    </Button>
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {tickets
            ? table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : Array.from({ length: 3 }, (_, i) => (
                <TableRow key={i}>
                  {skeletonWidths.map((width) => (
                    <TableCell key={width}><Skeleton className={`h-4 ${width}`} /></TableCell>
                  ))}
                </TableRow>
              ))}
        </TableBody>
      </Table>
      {data && (
        <Pagination page={data.page} total={data.total} onPageChange={onPageChange} />
      )}
    </div>
  )
}

type PaginationProps = {
  page: number
  total: number
  onPageChange: (page: number) => void
}

function Pagination({ page, total, onPageChange }: PaginationProps) {
  const pageCount = Math.ceil(total / PAGE_SIZE)
  const first = (page - 1) * PAGE_SIZE + 1
  const last = Math.min(page * PAGE_SIZE, total)

  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <p className="text-muted-foreground">
        Showing {first}–{last} of {total}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft aria-hidden="true" />
          Previous
        </Button>
        <span>
          Page {page} of {pageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          Next
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  )
}

export default TicketsTable
