import { render, screen, within } from '@testing-library/react'
import type { TicketsOnDay } from 'core/constants/ticket'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import TicketsPerDayChart from './TicketsPerDayChart.tsx'

// West of UTC, so a YYYY-MM-DD read as UTC midnight lands on the previous local day.
const originalTz = process.env.TZ
beforeAll(() => {
  process.env.TZ = 'America/New_York'
})
afterAll(() => {
  process.env.TZ = originalTz
})

const short: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
const long: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' }

// The expected label, built from local date parts as the component does.
function localDay(year: number, month: number, day: number, options = short) {
  return new Date(year, month - 1, day).toLocaleDateString(undefined, options)
}

const days: TicketsOnDay[] = [
  { date: '2026-03-01', count: 2 },
  { date: '2026-03-02', count: 1 },
  { date: '2026-03-03', count: 5 },
  { date: '2026-03-04', count: 0 },
]

function table() {
  return screen.getByRole('table', { name: 'Tickets per day' })
}

describe('TicketsPerDayChart', () => {
  it('shows a skeleton and no summary while the days load', () => {
    render(<TicketsPerDayChart />)

    expect(screen.getByText('Tickets per day')).toBeInTheDocument()
    // The skeleton has no role or name by design.
    expect(document.querySelector('[data-slot="skeleton"]')).toBeInTheDocument()
    expect(screen.queryByText('No tickets yet.')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText(/^\d+ tickets? · /)).not.toBeInTheDocument()
    expect(screen.queryByText('Busiest day')).not.toBeInTheDocument()
  })

  it('says there are no tickets and shows no summary for an empty list', () => {
    render(<TicketsPerDayChart days={[]} />)

    expect(screen.getByText('No tickets yet.')).toBeInTheDocument()
    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText(/^\d+ tickets? · /)).not.toBeInTheDocument()
    expect(screen.queryByText('Busiest day')).not.toBeInTheDocument()
  })

  it('sums the tickets and averages them per day in the header', () => {
    render(<TicketsPerDayChart days={days} />)

    expect(screen.getByText('8 tickets · 2.0 per day')).toBeInTheDocument()
    expect(screen.queryByText('No tickets yet.')).not.toBeInTheDocument()
    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeInTheDocument()
  })

  it('rounds the average to one decimal', () => {
    render(
      <TicketsPerDayChart
        days={[
          { date: '2026-03-01', count: 1 },
          { date: '2026-03-02', count: 0 },
          { date: '2026-03-03', count: 1 },
        ]}
      />,
    )

    // 2 / 3 = 0.666…
    expect(screen.getByText('2 tickets · 0.7 per day')).toBeInTheDocument()
  })

  it('says "1 ticket" for a single ticket', () => {
    render(<TicketsPerDayChart days={[{ date: '2026-03-01', count: 1 }]} />)

    expect(screen.getByText('1 ticket · 1.0 per day')).toBeInTheDocument()
  })

  it('shows the busiest day as a local date with its count', () => {
    render(<TicketsPerDayChart days={days} />)

    expect(screen.getByText('Busiest day')).toBeInTheDocument()
    expect(screen.getByText(`${localDay(2026, 3, 3)} · 5`)).toBeInTheDocument()
  })

  it('shows the first of several days with the same highest count', () => {
    render(
      <TicketsPerDayChart
        days={[
          { date: '2026-03-01', count: 1 },
          { date: '2026-03-02', count: 3 },
          { date: '2026-03-03', count: 3 },
        ]}
      />,
    )

    expect(screen.getByText(`${localDay(2026, 3, 2)} · 3`)).toBeInTheDocument()
    expect(screen.queryByText(`${localDay(2026, 3, 3)} · 3`)).not.toBeInTheDocument()
  })

  it('shows no busiest day when every day is 0', () => {
    render(
      <TicketsPerDayChart
        days={[
          { date: '2026-03-01', count: 0 },
          { date: '2026-03-02', count: 0 },
        ]}
      />,
    )

    expect(screen.getByText('0 tickets · 0.0 per day')).toBeInTheDocument()
    expect(screen.queryByText('Busiest day')).not.toBeInTheDocument()
  })

  it('lists every day and its count in an accessible table, as local dates', () => {
    render(<TicketsPerDayChart days={days} />)

    // Guards the test: in this zone, UTC parsing would show the day before.
    expect(new Date('2026-03-01').toLocaleDateString(undefined, long)).not.toBe(localDay(2026, 3, 1, long))

    const rows = within(table()).getAllByRole('row')
    expect(within(rows[0]).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Day', 'Tickets'])
    expect(rows.slice(1).map((row) => within(row).getAllByRole('cell').map((td) => td.textContent))).toEqual([
      [localDay(2026, 3, 1, long), '2'],
      [localDay(2026, 3, 2, long), '1'],
      [localDay(2026, 3, 3, long), '5'],
      [localDay(2026, 3, 4, long), '0'],
    ])
  })

  it('keeps the summary and the table past a month, where the chart switches to an area', () => {
    // 2026-01-01 to 2026-02-09, counting 0 to 39.
    const many: TicketsOnDay[] = Array.from({ length: 40 }, (_, i) => {
      const date = new Date(2026, 0, 1 + i)
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return { date: `2026-${month}-${day}`, count: i }
    })
    render(<TicketsPerDayChart days={many} />)

    expect(within(table()).getAllByRole('row')).toHaveLength(41)
    expect(screen.getByText('780 tickets · 19.5 per day')).toBeInTheDocument()
    expect(screen.getByText(`${localDay(2026, 2, 9)} · 39`)).toBeInTheDocument()
  })
})
