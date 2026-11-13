import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import type { TicketStats } from 'core/constants/ticket'
import { statsPeriodLabels, statsPeriods, ticketStatsQuerySchema, type StatsPeriod } from 'core/schemas/tickets'
import { Bot, Clock, Inbox, type LucideIcon, Sparkles, Ticket } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import TicketsPerDayChart from '@/components/TicketsPerDayChart.tsx'
import { Card, CardAction, CardContent, CardDescription, CardHeader } from '@/components/ui/card.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.tsx'
import { Skeleton } from '@/components/ui/skeleton.tsx'
import { errorMessage } from '@/lib/errorMessage.ts'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// The two largest units: "45m", "3h 20m", "2d 4h".
function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  const days = Math.floor(ms / DAY)
  const hours = Math.floor((ms % DAY) / HOUR)
  const minutes = Math.floor((ms % HOUR) / MINUTE)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function formatPercent(part: number, whole: number): string {
  return whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`
}

// A card with a link is clickable as a whole: the link's ::after covers the card, while its
// accessible name stays the label.
function StatCard({
  label,
  icon: Icon,
  to,
  footer,
  children,
}: {
  label: string
  icon: LucideIcon
  to?: string
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <Card className={to ? 'relative transition-colors hover:bg-muted/50' : undefined}>
      <CardHeader>
        <CardDescription>
          {to ? (
            <Link to={to} className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring">
              {label}
            </Link>
          ) : (
            label
          )}
        </CardDescription>
        <CardAction>
          <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-3xl font-semibold tabular-nums">{children}</div>
        {footer}
      </CardContent>
    </Card>
  )
}

// The value is in the card's text already, so the bar is decoration.
function ShareBar({ part, whole }: { part: number; whole: number }) {
  const percent = whole === 0 ? 0 : Math.min(100, (part / whole) * 100)
  return (
    <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
    </div>
  )
}

// Open is the backlog now, whatever the period.
const statCards: { label: string; icon: LucideIcon }[] = [
  { label: 'Total tickets', icon: Ticket },
  { label: 'Open tickets (now)', icon: Inbox },
  { label: 'Resolved by AI', icon: Bot },
  { label: 'Resolved by AI (%)', icon: Sparkles },
  { label: 'Avg. resolution time', icon: Clock },
]

const periodItems = statsPeriods.map((period) => ({ value: period, label: statsPeriodLabels[period] }))
const periodSchema = ticketStatsQuerySchema.shape.period
// Days are counted in the viewer's own time zone.
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

// The period lives in the URL (/?period=30d), so a view can be linked to; an invalid value
// falls back to all time, which is left out of the URL.
function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const parsedPeriod = periodSchema.safeParse(searchParams.get('period') ?? undefined)
  const period = parsedPeriod.success ? parsedPeriod.data : 'all'

  function handlePeriodChange(next: StatsPeriod) {
    setSearchParams(
      (params) => {
        if (next === 'all') params.delete('period')
        else params.set('period', next)
        return params
      },
      { replace: true },
    )
  }

  const { data: stats, error } = useQuery({
    queryKey: ['ticket-stats', period],
    queryFn: async () => (await axios.get<TicketStats>('/api/tickets/stats', { params: { period, tz: timeZone } })).data,
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <Select<StatsPeriod>
          items={periodItems}
          value={period}
          onValueChange={(next) => next && handlePeriodChange(next)}
        >
          <SelectTrigger aria-label="Period" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {periodItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          Couldn't load the dashboard: {errorMessage(error)}
        </p>
      ) : (
        <>
          <div aria-busy={!stats} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {!stats ? (
              statCards.map(({ label, icon }) => (
                <StatCard key={label} label={label} icon={icon}>
                  <Skeleton className="h-9 w-16" />
                </StatCard>
              ))
            ) : (
              <>
                <StatCard label="Total tickets" icon={Ticket} to="/tickets">
                  {stats.total}
                </StatCard>
                <StatCard label="Open tickets (now)" icon={Inbox} to="/tickets?status=open">
                  {stats.open}
                </StatCard>
                <StatCard label="Resolved by AI" icon={Bot}>
                  {stats.resolvedByAi}
                </StatCard>
                <StatCard
                  label="Resolved by AI (%)"
                  icon={Sparkles}
                  footer={<ShareBar part={stats.resolvedByAi} whole={stats.total} />}
                >
                  {formatPercent(stats.resolvedByAi, stats.total)}
                </StatCard>
                <StatCard label="Avg. resolution time" icon={Clock}>
                  {formatDuration(stats.averageResolutionMs)}
                </StatCard>
              </>
            )}
          </div>
          <TicketsPerDayChart days={stats?.ticketsPerDay} />
        </>
      )}
    </div>
  )
}

export default DashboardPage
