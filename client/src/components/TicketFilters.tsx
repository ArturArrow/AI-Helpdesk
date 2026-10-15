import { categoryLabels, TicketCategory } from 'core/constants/ticketCategory'
import { statusLabels, TicketStatus } from 'core/constants/ticketStatus'
import { UNCLASSIFIED, type TicketCategoryFilter } from 'core/schemas/tickets'
import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx'

export type TicketFilterValues = {
  status?: TicketStatus
  category?: TicketCategoryFilter
  q?: string
}

type TicketFiltersProps = {
  filters: TicketFilterValues
  onChange: (filters: TicketFilterValues) => void
}

// A null item is "all", so each select can be cleared from its own list.
const statusItems: { value: TicketStatus | null; label: string }[] = [
  { value: null, label: 'All statuses' },
  ...Object.values(TicketStatus).map((status) => ({ value: status, label: statusLabels[status] })),
]

const categoryItems: { value: TicketCategoryFilter | null; label: string }[] = [
  { value: null, label: 'All categories' },
  ...Object.values(TicketCategory).map((category) => ({
    value: category,
    label: categoryLabels[category],
  })),
  { value: UNCLASSIFIED, label: 'Unclassified' },
]

const SEARCH_DELAY_MS = 300

function TicketFilters({ filters, onChange }: TicketFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput
        value={filters.q}
        onSearch={(q) => onChange({ ...filters, q })}
      />
      <Select<TicketStatus>
        items={statusItems}
        value={filters.status ?? null}
        onValueChange={(status) => onChange({ ...filters, status: status ?? undefined })}
      >
        <SelectTrigger aria-label="Filter by status" className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {statusItems.map((item) => (
            <SelectItem key={item.label} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select<TicketCategoryFilter>
        items={categoryItems}
        value={filters.category ?? null}
        onValueChange={(category) => onChange({ ...filters, category: category ?? undefined })}
      >
        <SelectTrigger aria-label="Filter by category" className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {categoryItems.map((item) => (
            <SelectItem key={item.label} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {(filters.status || filters.category || filters.q) && (
        <Button variant="ghost" onClick={() => onChange({})}>
          Clear filters
        </Button>
      )}
    </div>
  )
}

// Keeps its own text so typing stays instant, and reports it (trimmed, blank as undefined)
// once typing pauses, so the list isn't re-fetched on every keystroke.
function SearchInput({ value, onSearch }: { value?: string; onSearch: (q?: string) => void }) {
  const [text, setText] = useState(value ?? '')

  // Follow changes made elsewhere (Clear filters, the back button), but not the echo of our
  // own search, which would drop a trailing space the user is still typing after.
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    if ((value ?? '') !== text.trim()) setText(value ?? '')
  }

  useEffect(() => {
    const q = text.trim()
    if (q === (value ?? '')) return
    const timer = setTimeout(() => onSearch(q || undefined), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [text, value, onSearch])

  return (
    <div className="relative w-full sm:w-64">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        aria-label="Search tickets"
        placeholder="Search…"
        className="pl-8"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
    </div>
  )
}

export default TicketFilters
