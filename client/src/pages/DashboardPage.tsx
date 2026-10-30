import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import type { TicketStats } from 'core/constants/ticket'
import { statsPeriodLabels, statsPeriods, ticketStatsQuerySchema, type StatsPeriod } from 'core/schemas/tickets'
import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card.tsx'
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

function StatCard({ label, to, children }: { label: string; to?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{to ? <Link to={to} className="hover:underline">{label}</Link> : label}</CardDescription>
      </CardHeader>
      <CardContent className="text-3xl font-semibold tabular-nums">{children}</CardContent>
    </Card>
  )
}

// Open is the backlog now, whatever the period.
const statLabels = ['Total tickets', 'Open tickets (now)', 'Resolved by AI', 'Resolved by AI (%)', 'Avg. resolution time']

const periodItems = statsPeriods.map((period) => ({ value: period, label: statsPeriodLabels[period] }))
const periodSchema = ticketStatsQuerySchema.shape.period

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
    queryFn: async () => (await axios.get<TicketStats>('/api/tickets/stats', { params: { period } })).data,
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
        <div aria-busy={!stats} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {!stats ? (
            statLabels.map((label) => (
              <StatCard key={label} label={label}>
                <Skeleton className="h-9 w-16" />
              </StatCard>
            ))
          ) : (
            <>
              <StatCard label="Total tickets" to="/tickets">{stats.total}</StatCard>
              <StatCard label="Open tickets (now)" to="/tickets?status=open">{stats.open}</StatCard>
              <StatCard label="Resolved by AI">{stats.resolvedByAi}</StatCard>
              <StatCard label="Resolved by AI (%)">{formatPercent(stats.resolvedByAi, stats.total)}</StatCard>
              <StatCard label="Avg. resolution time">{formatDuration(stats.averageResolutionMs)}</StatCard>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default DashboardPage
