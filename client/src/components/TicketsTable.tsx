import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  createColumnHelper,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type SortingState,
} from '@tanstack/react-table'
import axios from 'axios'
import { TicketCategory } from 'core/constants/ticketCategory'
import { TicketStatus } from 'core/constants/ticketStatus'
import type { TicketListQuery, TicketSortField } from 'core/schemas/tickets'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { useState } from 'react'
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
import { categoryLabels } from '@/lib/ticketLabels.ts'

export type Ticket = {
  id: number
  subject: string
  senderName: string
  senderEmail: string
  status: TicketStatus
  category: TicketCategory | null
  createdAt: string
}

const features = tableFeatures({ rowSortingFeature })
const columnHelper = createColumnHelper<typeof features, Ticket>()

// Column ids double as the server's sortBy values (ticketSortFields in core).
const columns = columnHelper.columns([
  columnHelper.accessor('subject', {
    header: 'Subject',
    cell: ({ getValue }) => <div className="max-w-80 truncate font-medium">{getValue()}</div>,
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

const skeletonWidths = ['w-56', 'w-40', 'w-14', 'w-28', 'w-32']

// Sorting and filtering happen on the server: the table only tracks which column is sorted
// and renders the rows the API returns, in its order.
function TicketsTable({ filters }: { filters: TicketFilterValues }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'createdAt', desc: true }])
  const { id, desc } = sorting[0]!
  const params: TicketListQuery = {
    sortBy: id as TicketSortField,
    sortOrder: desc ? 'desc' : 'asc',
    ...filters,
  }

  const { data: tickets, error, isPlaceholderData } = useQuery({
    queryKey: ['tickets', params],
    queryFn: async () => {
      const res = await axios.get<{ tickets: Ticket[] }>('/api/tickets', { params })
      return res.data.tickets
    },
    // Keep the current rows on screen while a re-sort loads.
    placeholderData: keepPreviousData,
  })

  const table = useTable({
    features,
    columns,
    data: tickets ?? [],
    state: { sorting },
    onSortingChange: setSorting,
    manualSorting: true,
    enableMultiSort: false,
    enableSortingRemoval: false,
    sortDescFirst: false,
  })

  return error ? (
    <p role="alert" className="text-sm text-destructive">
      Couldn't load tickets: {errorMessage(error)}
    </p>
  ) : tickets?.length === 0 ? (
    <p className="text-muted-foreground">
      {filters.status || filters.category || filters.q
        ? 'No tickets match these filters.'
        : 'No tickets yet.'}
    </p>
  ) : (
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
  )
}

function errorMessage(error: Error) {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined
  return status ? `Request failed (${status})` : 'Request failed'
}

export default TicketsTable
