import type { TicketsOnDay } from 'core/constants/ticket'
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx'
import { Skeleton } from '@/components/ui/skeleton.tsx'

// YYYY-MM-DD is a calendar day in the viewer's zone; new Date(string) would read it as UTC midnight.
function formatDay(date: string, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(undefined, options)
}

function ticketCount(count: number) {
  return `${count} ${count === 1 ? 'ticket' : 'tickets'}`
}

// Plain CSS bars: one series, so no legend; the hover label carries the exact value, and a
// visually hidden table gives screen readers the same numbers.
function TicketsPerDayChart({ days }: { days?: TicketsOnDay[] }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const max = days ? Math.max(1, ...days.map((day) => day.count)) : 1
  const active = days && hovered !== null ? days[hovered] : undefined

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tickets per day</CardTitle>
      </CardHeader>
      <CardContent>
        {!days ? (
          <Skeleton className="h-48 w-full" />
        ) : days.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tickets yet.</p>
        ) : (
          <figure>
            <div className="flex gap-2">
              <div aria-hidden="true" className="flex h-48 flex-col justify-between text-right text-xs text-muted-foreground tabular-nums">
                <span>{max}</span>
                <span>0</span>
              </div>
              <div className="relative min-w-0 flex-1">
                <div
                  aria-hidden="true"
                  className={`flex h-48 items-end border-t border-b border-border ${days.length <= 31 ? 'gap-0.5' : 'gap-px'}`}
                  onMouseLeave={() => setHovered(null)}
                >
                  {days.map((day, index) => (
                    <div
                      key={day.date}
                      data-testid="bar"
                      className="flex h-full min-w-0 flex-1 items-end"
                      onMouseEnter={() => setHovered(index)}
                    >
                      <div
                        className={`w-full rounded-t-sm ${hovered === index ? 'bg-primary/70' : 'bg-primary'}`}
                        style={{ height: day.count === 0 ? 0 : `max(2px, ${(day.count / max) * 100}%)` }}
                      />
                    </div>
                  ))}
                </div>
                {active && hovered !== null && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -top-2 -translate-x-1/2 -translate-y-full rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-sm"
                    style={{ left: `${((hovered + 0.5) / days.length) * 100}%` }}
                  >
                    <span className="font-medium">{formatDay(active.date)}</span>: {ticketCount(active.count)}
                  </div>
                )}
                <div aria-hidden="true" className="mt-1 flex justify-between text-xs text-muted-foreground">
                  <span>{formatDay(days[0].date)}</span>
                  {days.length > 1 && <span>{formatDay(days[days.length - 1].date)}</span>}
                </div>
              </div>
            </div>
            <table className="sr-only">
              <caption>Tickets per day</caption>
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">Tickets</th>
                </tr>
              </thead>
              <tbody>
                {days.map((day) => (
                  <tr key={day.date}>
                    <td>{formatDay(day.date, { year: 'numeric', month: 'long', day: 'numeric' })}</td>
                    <td>{day.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </figure>
        )}
      </CardContent>
    </Card>
  )
}

export default TicketsPerDayChart
