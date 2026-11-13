import type { TicketsOnDay } from 'core/constants/ticket'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx'
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart.tsx'
import { Skeleton } from '@/components/ui/skeleton.tsx'

// YYYY-MM-DD is a calendar day in the viewer's zone; new Date(string) would read it as UTC midnight.
function formatDay(date: string, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(undefined, options)
}

function ticketCount(count: number) {
  return `${count} ${count === 1 ? 'ticket' : 'tickets'}`
}

const chartConfig = {
  count: { label: 'Tickets', color: 'var(--chart-2)' },
} satisfies ChartConfig

// Up to a month reads well as bars; past that they thin into lines, so it's an area instead.
const MAX_BAR_DAYS = 31

const longDay: Intl.DateTimeFormatOptions = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }

function Chart({ days }: { days: TicketsOnDay[] }) {
  const grid = <CartesianGrid vertical={false} />
  const xAxis = (
    <XAxis
      dataKey="date"
      tickFormatter={(date: string) => formatDay(date)}
      tickLine={false}
      axisLine={false}
      tickMargin={8}
      minTickGap={24}
    />
  )
  const yAxis = <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
  const tooltip = (
    <ChartTooltip
      cursor={days.length <= MAX_BAR_DAYS ? undefined : { strokeDasharray: '4 4' }}
      content={<ChartTooltipContent labelFormatter={(_, payload) => formatDay(payload[0]?.payload.date, longDay)} />}
    />
  )

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full" aria-hidden="true">
      {days.length <= MAX_BAR_DAYS ? (
        <BarChart data={days} margin={{ left: 0, right: 8, top: 8 }}>
          {grid}
          {xAxis}
          {yAxis}
          {tooltip}
          <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} maxBarSize={48} />
        </BarChart>
      ) : (
        <AreaChart data={days} margin={{ left: 0, right: 8, top: 8 }}>
          <defs>
            <linearGradient id="ticketsPerDayFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-count)" stopOpacity={0.6} />
              <stop offset="95%" stopColor="var(--color-count)" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          {grid}
          {xAxis}
          {yAxis}
          {tooltip}
          <Area
            dataKey="count"
            type="monotone"
            stroke="var(--color-count)"
            strokeWidth={2}
            fill="url(#ticketsPerDayFill)"
          />
        </AreaChart>
      )}
    </ChartContainer>
  )
}

// One series, so no legend. The chart is hidden from screen readers; a visually hidden table
// gives them the same numbers.
function TicketsPerDayChart({ days }: { days?: TicketsOnDay[] }) {
  const total = days?.reduce((sum, day) => sum + day.count, 0) ?? 0
  const peak = days?.reduce<TicketsOnDay | undefined>((best, day) => (!best || day.count > best.count ? day : best), undefined)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tickets per day</CardTitle>
        {days && days.length > 0 && (
          <CardDescription>
            {ticketCount(total)} · {(total / days.length).toFixed(1)} per day
          </CardDescription>
        )}
        {peak && peak.count > 0 && (
          <CardAction className="text-right text-sm">
            <div className="text-muted-foreground">Busiest day</div>
            <div className="font-medium tabular-nums">
              {formatDay(peak.date)} · {peak.count}
            </div>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {!days ? (
          <Skeleton className="h-64 w-full" />
        ) : days.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tickets yet.</p>
        ) : (
          <figure>
            <Chart days={days} />
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
