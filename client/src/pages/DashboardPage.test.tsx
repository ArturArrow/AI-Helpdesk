import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axios, { AxiosError } from 'axios'
import type { TicketStats } from 'core/constants/ticket'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpError } from '@/test/http.ts'
import { navigationType, urlSearch } from '@/test/location.ts'
import { LocationProbe } from '@/test/LocationProbe.tsx'
import { renderWithRouter } from '@/test/render.tsx'
import { choose } from '@/test/select.ts'
import DashboardPage from './DashboardPage.tsx'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const labels = ['Total tickets', 'Open tickets (now)', 'Resolved by AI', 'Resolved by AI (%)', 'Avg. resolution time']

function mockStats(stats: TicketStats) {
  return vi.spyOn(axios, 'get').mockResolvedValue({ data: stats })
}

const stats: TicketStats = { total: 42, open: 17, resolvedByAi: 9, averageResolutionMs: HOUR, ticketsPerDay: [] }
// The page sends the viewer's time zone, resolved the same way.
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone

function periodSelect() {
  return screen.getByRole('combobox', { name: 'Period' })
}

function renderAt(route: string) {
  renderWithRouter(
    <>
      <DashboardPage />
      <LocationProbe />
    </>,
    route,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DashboardPage', () => {
  it('shows a skeleton in each card while the stats load', () => {
    vi.spyOn(axios, 'get').mockReturnValue(new Promise(() => {}))
    renderWithRouter(<DashboardPage />)

    expect(screen.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument()
    // The card grid has no role or name; aria-busy is what marks it for assistive tech.
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    for (const label of labels) expect(screen.getByText(label)).toBeInTheDocument()
    // Labels aren't links until there's data behind them.
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('shows the five stats from GET /api/tickets/stats', async () => {
    const get = mockStats({ total: 42, open: 17, resolvedByAi: 9, averageResolutionMs: 3 * HOUR + 20 * MINUTE, ticketsPerDay: [] })
    renderWithRouter(<DashboardPage />)

    expect(await screen.findByText('42')).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/api/tickets/stats', { params: { period: 'all', tz } })
    expect(document.querySelector('[aria-busy]')).toHaveAttribute('aria-busy', 'false')
    for (const label of labels) expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.getByText('17')).toBeInTheDocument()
    expect(screen.getByText('9')).toBeInTheDocument()
    // 9 / 42 = 21.4%
    expect(screen.getByText('21%')).toBeInTheDocument()
    expect(screen.getByText('3h 20m')).toBeInTheDocument()
  })

  it('links the total and open cards to the ticket list', async () => {
    mockStats({ total: 42, open: 17, resolvedByAi: 9, averageResolutionMs: HOUR, ticketsPerDay: [] })
    renderWithRouter(<DashboardPage />)

    expect(await screen.findByRole('link', { name: 'Total tickets' })).toHaveAttribute('href', '/tickets')
    expect(screen.getByRole('link', { name: 'Open tickets (now)' })).toHaveAttribute('href', '/tickets?status=open')
    expect(screen.getAllByRole('link')).toHaveLength(2)
  })

  it.each([
    { resolvedByAi: 2, total: 3, expected: '67%' },
    { resolvedByAi: 1, total: 8, expected: '13%' },
    { resolvedByAi: 1, total: 3, expected: '33%' },
  ])('rounds $resolvedByAi of $total to $expected', async ({ resolvedByAi, total, expected }) => {
    mockStats({ total, open: 0, resolvedByAi, averageResolutionMs: HOUR, ticketsPerDay: [] })
    renderWithRouter(<DashboardPage />)

    expect(await screen.findByText(expected)).toBeInTheDocument()
  })

  it('shows "—" for the percentage with no tickets and for a null average', async () => {
    mockStats({ total: 0, open: 0, resolvedByAi: 0, averageResolutionMs: null, ticketsPerDay: [] })
    renderWithRouter(<DashboardPage />)

    expect(await screen.findAllByText('—')).toHaveLength(2)
    expect(screen.getAllByText('0')).toHaveLength(3)
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument()
  })

  it.each([
    { ms: 45 * MINUTE + 30 * 1000, expected: '45m' },
    { ms: 0, expected: '0m' },
    { ms: 3 * HOUR + 20 * MINUTE, expected: '3h 20m' },
    { ms: 2 * HOUR, expected: '2h 0m' },
    { ms: 2 * DAY + 4 * HOUR + 59 * MINUTE, expected: '2d 4h' },
  ])('formats an average of $ms ms as $expected', async ({ ms, expected }) => {
    mockStats({ total: 10, open: 5, resolvedByAi: 1, averageResolutionMs: ms, ticketsPerDay: [] })
    renderWithRouter(<DashboardPage />)

    expect(await screen.findByText(expected)).toBeInTheDocument()
  })

  it('shows the chart loading with the stats, then the days from the response', async () => {
    const get = mockStats({
      ...stats,
      ticketsPerDay: [
        { date: '2026-03-01', count: 4 },
        { date: '2026-03-02', count: 0 },
      ],
    })
    renderWithRouter(<DashboardPage />)

    expect(screen.getByText('Tickets per day')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    const table = await screen.findByRole('table', { name: 'Tickets per day' })
    expect(get).toHaveBeenCalledWith('/api/tickets/stats', { params: { period: 'all', tz } })
    const long: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' }
    expect(within(table).getAllByRole('row').slice(1).map((row) => row.textContent)).toEqual([
      `${new Date(2026, 2, 1).toLocaleDateString(undefined, long)}4`,
      `${new Date(2026, 2, 2).toLocaleDateString(undefined, long)}0`,
    ])
    expect(screen.getAllByTestId('bar')).toHaveLength(2)
  })

  it('shows "No tickets yet." in the chart when the response has no days', async () => {
    mockStats(stats)
    renderWithRouter(<DashboardPage />)

    expect(await screen.findByText('No tickets yet.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows the HTTP status when the request fails', async () => {
    vi.spyOn(axios, 'get').mockRejectedValue(httpError(500))
    renderWithRouter(<DashboardPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the dashboard: Request failed (500)")
    expect(screen.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument()
    expect(screen.queryByText('Total tickets')).not.toBeInTheDocument()
    expect(screen.queryByText('Tickets per day')).not.toBeInTheDocument()
    expect(document.querySelector('[aria-busy]')).not.toBeInTheDocument()
  })

  it('shows a generic message when the request fails without a response', async () => {
    vi.spyOn(axios, 'get').mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK'))
    renderWithRouter(<DashboardPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/^Couldn't load the dashboard: Request failed$/)
  })

  describe('period', () => {
    it('requests all time and shows "All time" without a period in the URL', async () => {
      const get = mockStats(stats)
      renderAt('/')
      await screen.findByText('42')

      expect(get).toHaveBeenCalledTimes(1)
      expect(get).toHaveBeenCalledWith('/api/tickets/stats', { params: { period: 'all', tz } })
      expect(periodSelect()).toHaveTextContent('All time')
    })

    it('offers the four periods', async () => {
      const user = userEvent.setup()
      mockStats(stats)
      renderAt('/')
      await screen.findByText('42')

      await user.click(periodSelect())
      const options = await screen.findAllByRole('option')
      expect(options.map((o) => o.textContent)).toEqual(['Last 7 days', 'Last 30 days', 'Last 90 days', 'All time'])
    })

    it('preselects and requests the period from the URL', async () => {
      const get = mockStats(stats)
      renderAt('/?period=7d')
      await screen.findByText('42')

      expect(get).toHaveBeenCalledTimes(1)
      expect(get).toHaveBeenCalledWith('/api/tickets/stats', { params: { period: '7d', tz } })
      expect(periodSelect()).toHaveTextContent('Last 7 days')
    })

    it('falls back to all time when the URL period is invalid', async () => {
      const get = mockStats(stats)
      renderAt('/?period=1y')
      await screen.findByText('42')

      expect(get).toHaveBeenCalledTimes(1)
      expect(get).toHaveBeenCalledWith('/api/tickets/stats', { params: { period: 'all', tz } })
      expect(periodSelect()).toHaveTextContent('All time')
    })

    it('re-requests with the chosen period and writes it to the URL, replacing the entry', async () => {
      const user = userEvent.setup()
      const get = mockStats(stats)
      renderAt('/')
      await screen.findByText('42')

      await choose(user, periodSelect(), 'Last 30 days')

      await waitFor(() =>
        expect(get).toHaveBeenLastCalledWith('/api/tickets/stats', { params: { period: '30d', tz } }),
      )
      expect(periodSelect()).toHaveTextContent('Last 30 days')
      expect(urlSearch()).toBe('?period=30d')
      expect(navigationType()).toBe('REPLACE')
    })

    it('removes the period from the URL when "All time" is chosen', async () => {
      const user = userEvent.setup()
      const get = mockStats(stats)
      renderAt('/?period=30d')
      await screen.findByText('42')
      expect(urlSearch()).toBe('?period=30d')

      await choose(user, periodSelect(), 'All time')

      await waitFor(() =>
        expect(get).toHaveBeenLastCalledWith('/api/tickets/stats', { params: { period: 'all', tz } }),
      )
      expect(periodSelect()).toHaveTextContent('All time')
      expect(urlSearch()).toBe('')
      expect(navigationType()).toBe('REPLACE')
    })
  })
})
