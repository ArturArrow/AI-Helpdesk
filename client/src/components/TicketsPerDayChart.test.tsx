import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

// The hover label splits its text over two elements and has no role, so match its full text.
function hoverLabel(text: string) {
  return screen.queryByText((_, element) => element?.textContent === text)
}

function table() {
  return screen.getByRole('table', { name: 'Tickets per day' })
}

describe('TicketsPerDayChart', () => {
  it('shows a skeleton while the days load', () => {
    render(<TicketsPerDayChart />)

    expect(screen.getByText('Tickets per day')).toBeInTheDocument()
    // The skeleton has no role or name by design.
    expect(document.querySelector('[data-slot="skeleton"]')).toBeInTheDocument()
    expect(screen.queryByText('No tickets yet.')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryAllByTestId('bar')).toHaveLength(0)
  })

  it('says there are no tickets for an empty list', () => {
    render(<TicketsPerDayChart days={[]} />)

    expect(screen.getByText('No tickets yet.')).toBeInTheDocument()
    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryAllByTestId('bar')).toHaveLength(0)
  })

  it('draws one bar per day', () => {
    render(<TicketsPerDayChart days={days} />)

    expect(screen.getAllByTestId('bar')).toHaveLength(4)
    expect(screen.queryByText('No tickets yet.')).not.toBeInTheDocument()
    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeInTheDocument()
  })

  it('labels the y-axis with the highest count and 0', () => {
    render(<TicketsPerDayChart days={days} />)

    // Once on the axis and once in the accessible table.
    expect(screen.getAllByText('5')).toHaveLength(2)
    expect(within(table()).getAllByText('5')).toHaveLength(1)
    expect(screen.getAllByText('0')).toHaveLength(2)
    expect(within(table()).getAllByText('0')).toHaveLength(1)
  })

  it('tops the y-axis at 1 when every day is 0', () => {
    render(
      <TicketsPerDayChart
        days={[
          { date: '2026-03-01', count: 0 },
          { date: '2026-03-02', count: 0 },
        ]}
      />,
    )

    expect(screen.getByText('1')).toBeInTheDocument()
    expect(within(table()).queryByText('1')).not.toBeInTheDocument()
  })

  it('labels the first and last day as local dates', () => {
    render(<TicketsPerDayChart days={days} />)

    const first = localDay(2026, 3, 1)
    const last = localDay(2026, 3, 4)
    // Guards the test: in this zone, UTC parsing would show the day before.
    expect(new Date('2026-03-01').toLocaleDateString(undefined, short)).not.toBe(first)

    expect(screen.getByText(first)).toBeInTheDocument()
    expect(screen.getByText(last)).toBeInTheDocument()
    expect(screen.queryByText(localDay(2026, 2, 28))).not.toBeInTheDocument()
    expect(screen.queryByText(localDay(2026, 3, 2))).not.toBeInTheDocument()
  })

  it('labels a single day once', () => {
    render(<TicketsPerDayChart days={[{ date: '2026-03-01', count: 3 }]} />)

    expect(screen.getAllByText(localDay(2026, 3, 1))).toHaveLength(1)
  })

  it('shows the day and count of the hovered bar, singular for 1', async () => {
    const user = userEvent.setup()
    render(<TicketsPerDayChart days={days} />)
    const bars = screen.getAllByTestId('bar')

    await user.hover(bars[1])
    expect(hoverLabel(`${localDay(2026, 3, 2)}: 1 ticket`)).toBeInTheDocument()

    await user.hover(bars[2])
    expect(hoverLabel(`${localDay(2026, 3, 3)}: 5 tickets`)).toBeInTheDocument()
    expect(hoverLabel(`${localDay(2026, 3, 2)}: 1 ticket`)).not.toBeInTheDocument()

    await user.hover(bars[3])
    expect(hoverLabel(`${localDay(2026, 3, 4)}: 0 tickets`)).toBeInTheDocument()
  })

  it('hides the hover label when the pointer leaves the bars', async () => {
    const user = userEvent.setup()
    render(<TicketsPerDayChart days={days} />)
    const bars = screen.getAllByTestId('bar')

    await user.hover(bars[0])
    expect(hoverLabel(`${localDay(2026, 3, 1)}: 2 tickets`)).toBeInTheDocument()

    await user.unhover(bars[0])
    expect(hoverLabel(`${localDay(2026, 3, 1)}: 2 tickets`)).not.toBeInTheDocument()
  })

  it('lists every day and its count in an accessible table', () => {
    render(<TicketsPerDayChart days={days} />)

    const rows = within(table()).getAllByRole('row')
    expect(within(rows[0]).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Day', 'Tickets'])
    expect(rows.slice(1).map((row) => within(row).getAllByRole('cell').map((td) => td.textContent))).toEqual([
      [localDay(2026, 3, 1, long), '2'],
      [localDay(2026, 3, 2, long), '1'],
      [localDay(2026, 3, 3, long), '5'],
      [localDay(2026, 3, 4, long), '0'],
    ])
  })
})
