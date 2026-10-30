import { expect, test, type APIRequestContext } from '@playwright/test'
import { ADMIN, AGENT, signInViaApi } from '../fixtures/auth.js'
import {
  addAiReplyInDb,
  createTicketViaWebhook,
  deleteAllTicketsInDb,
  setTicketInDb,
  setTicketStatusInDb,
  updateTicketViaApi,
} from '../fixtures/tickets.js'
import { uniqueSuffix } from '../fixtures/users.js'
import { inboundSecret } from '../fixtures/webhook.js'

// GET /api/tickets/stats returns { total, open, resolvedByAi, averageResolutionMs, ticketsPerDay }
// over every ticket in the database, so the tests that check the numbers start from an empty
// ticket table (deleteAllTicketsInDb) and create exactly the tickets they count. Other specs find
// their own tickets by unique values, so emptying the table can't break them.
//
// resolvedAt isn't in any response; averageResolutionMs is how the tests observe it. They set
// createdAt (and, where noted, resolvedAt) directly in the DB to get known durations.

const HOUR = 60 * 60 * 1000

type TicketCounts = { total: number; open: number; resolvedByAi: number; averageResolutionMs: number | null }
type TicketsOnDay = { date: string; count: number }
type TicketStats = TicketCounts & { ticketsPerDay: TicketsOnDay[] }

const DAY = 24 * HOUR

const PERIOD_ERROR = 'period must be one of: 7d, 30d, 90d, all'
const TZ_ERROR = 'tz must be a time zone'

// `request` must be signed in (as anyone). Only the given params are sent.
async function getStats(request: APIRequestContext, params: { period?: string; tz?: string } = {}): Promise<TicketStats> {
  const res = await request.get('/api/tickets/stats', { params })
  expect(res.status(), `stats for ${JSON.stringify(params)}`).toBe(200)
  return res.json()
}

// The four numbers without ticketsPerDay, for the tests that check only those. Without a period,
// no query string is sent.
async function getCounts(request: APIRequestContext, period?: string): Promise<TicketCounts> {
  const { ticketsPerDay: _days, ...counts } = await getStats(request, period === undefined ? {} : { period })
  return counts
}

const averageOf = async (request: APIRequestContext) => (await getCounts(request)).averageResolutionMs

// Calendar dates as YYYY-MM-DD, the format of ticketsPerDay.
function dateIn(tz: string, at = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at)
  const part = (type: string) => parts.find((p) => p.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10)

// Every date from first through last, oldest first.
function datesFrom(first: string, last: string) {
  const dates: string[] = []
  for (let date = first; date <= last; date = addDays(date, 1)) dates.push(date)
  return dates
}

// The UTC instant (ms) of a wall-clock time (HH:MM) on a date in tz.
function atLocal(date: string, time: string, tz: string) {
  const asUtc = Date.parse(`${date}T${time}:00Z`)
  const offset = (at: number) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(at)
    const part = (type: string) => Number(parts.find((p) => p.type === type)!.value)
    return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute')) - Math.floor(at / 60_000) * 60_000
  }
  return asUtc - offset(asUtc - offset(asUtc))
}

const noonUtc = (date: string) => new Date(`${date}T12:00:00Z`)

const countOn = (days: TicketsOnDay[], date: string) => days.find((day) => day.date === date)?.count
const sumOf = (days: TicketsOnDay[]) => days.reduce((sum, day) => sum + day.count, 0)

// Runs `fetch` with today's date in each zone, and again if a date changed while it ran (the test
// crossed midnight in a zone), so the server's "today" and the test's always agree. `fetch` must
// create its own tickets and only collect responses; assert on what it returns, after.
async function onStableDays<T>(zones: string[], fetch: (today: Record<string, string>) => Promise<T>) {
  const todayIn = () => Object.fromEntries(zones.map((tz) => [tz, dateIn(tz)]))
  for (let attempt = 1; attempt <= 3; attempt++) {
    const today = todayIn()
    const result = await fetch(today)
    if (zones.every((tz) => dateIn(tz) === today[tz])) return { today, result }
  }
  throw new Error('the date kept changing during the test')
}

test.describe('GET /api/tickets/stats: auth', () => {
  test('401 without a session', async ({ request }) => {
    const res = await request.get('/api/tickets/stats')
    expect(res.status()).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  for (const user of [AGENT, ADMIN]) {
    test(`200 for the ${user.name.toLowerCase()} with exactly total, open, resolvedByAi, averageResolutionMs and ticketsPerDay`, async ({ request }) => {
      await signInViaApi(request, user)
      const res = await request.get('/api/tickets/stats')
      expect(res.status()).toBe(200)
      const stats = await res.json()
      expect(Object.keys(stats).sort()).toEqual(['averageResolutionMs', 'open', 'resolvedByAi', 'ticketsPerDay', 'total'])
      expect(stats).toMatchObject({
        total: expect.any(Number),
        open: expect.any(Number),
        resolvedByAi: expect.any(Number),
      })
      if (stats.averageResolutionMs !== null) expect(typeof stats.averageResolutionMs).toBe('number')
      expect(Array.isArray(stats.ticketsPerDay)).toBe(true)
      for (const day of stats.ticketsPerDay) {
        expect(day).toEqual({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), count: expect.any(Number) })
      }
    })
  }
})

test.describe('GET /api/tickets/stats: counts', () => {
  test.beforeEach(() => deleteAllTicketsInDb())

  test('all zero, a null average and no days with no tickets', async ({ request }) => {
    await signInViaApi(request, AGENT)
    expect(await getStats(request)).toEqual({ total: 0, open: 0, resolvedByAi: 0, averageResolutionMs: null, ticketsPerDay: [] })
  })

  test('total counts every status including new and processing; open counts only open; resolvedByAi counts finished tickets with an ai reply, once each', async ({ request }) => {
    await createTicketViaWebhook(request, 'stats-open')
    const openWithAi = await createTicketViaWebhook(request, 'stats-open-ai')
    const resolvedWithAi = await createTicketViaWebhook(request, 'stats-resolved-ai')
    const closedWithAi = await createTicketViaWebhook(request, 'stats-closed-ai')
    const resolved = await createTicketViaWebhook(request, 'stats-resolved')
    const closed = await createTicketViaWebhook(request, 'stats-closed')
    const created = await createTicketViaWebhook(request, 'stats-new')
    const processing = await createTicketViaWebhook(request, 'stats-processing')

    // An ai reply on an open ticket (reopened after the AI answered) doesn't count.
    addAiReplyInDb(openWithAi.id, 'Answered by the AI, then reopened.')
    setTicketStatusInDb(resolvedWithAi.id, 'resolved')
    addAiReplyInDb(resolvedWithAi.id, 'First AI answer.')
    // A second ai reply on the same ticket still counts it once.
    addAiReplyInDb(resolvedWithAi.id, 'Second AI answer.')
    setTicketStatusInDb(closedWithAi.id, 'closed')
    addAiReplyInDb(closedWithAi.id, 'AI answer, later closed.')
    setTicketStatusInDb(resolved.id, 'resolved')
    setTicketStatusInDb(closed.id, 'closed')
    setTicketStatusInDb(created.id, 'new')
    setTicketStatusInDb(processing.id, 'processing')

    await signInViaApi(request, AGENT)
    const stats = await getCounts(request)
    expect(stats).toMatchObject({ total: 8, open: 2, resolvedByAi: 2 })
  })

  test('a new ticket from the webhook counts in total and open at once', async ({ request }) => {
    await createTicketViaWebhook(request, 'stats-webhook')
    await signInViaApi(request, AGENT)
    expect(await getCounts(request)).toEqual({ total: 1, open: 1, resolvedByAi: 0, averageResolutionMs: null })
  })
})

// ?period=7d|30d|90d limits total, resolvedByAi and averageResolutionMs to tickets created in the
// last 7, 30 or 90 calendar days (today included, in tz, UTC by default); open always counts every
// open ticket. These tickets sit at least 3 days inside or outside every period's first midnight,
// so neither the time of day nor the time between setting createdAt and the request can move them
// across. The ticketsPerDay and tz tests below place tickets on exact days.
test.describe('GET /api/tickets/stats: period', () => {
  for (const period of ['week', '7', '7D', '1d', '365d', 'ALL', '']) {
    test(`period=${JSON.stringify(period)} gets 400 with the allowed periods`, async ({ request }) => {
      await signInViaApi(request, AGENT)
      const res = await request.get('/api/tickets/stats', { params: { period } })
      expect(res.status()).toBe(400)
      expect(await res.json()).toEqual({ error: PERIOD_ERROR })
    })
  }

  test('a repeated period param gets 400 instead of using either value', async ({ request }) => {
    await signInViaApi(request, AGENT)
    const res = await request.get('/api/tickets/stats?period=7d&period=30d')
    expect(res.status()).toBe(400)
    expect(await res.json()).toEqual({ error: PERIOD_ERROR })
  })

  test('401 without a session, even with an invalid period', async ({ request }) => {
    const res = await request.get('/api/tickets/stats', { params: { period: 'week' } })
    expect(res.status()).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  test.describe('counts', () => {
    test.beforeEach(() => deleteAllTicketsInDb())

    test('each period counts total, resolvedByAi and the exact average over tickets created inside it; open counts every open ticket; no period equals all', async ({ request }) => {
      const now = Date.now()
      // Durations of 1, 3, 5 and 7 hours, so every period's average is a whole number of hours.
      const finished = async (label: string, daysAgo: number, hours: number, status: string, aiReply: boolean) => {
        const ticket = await createTicketViaWebhook(request, label)
        const createdAt = new Date(now - daysAgo * DAY)
        setTicketInDb(ticket.id, { status, createdAt, resolvedAt: new Date(createdAt.getTime() + hours * HOUR) })
        if (aiReply) addAiReplyInDb(ticket.id, `AI answer for ${label}.`)
      }
      await createTicketViaWebhook(request, 'period-open-now')
      await finished('period-3d-ai', 3, 1, 'resolved', true)
      await finished('period-20d', 20, 3, 'closed', false)
      const oldOpen = await createTicketViaWebhook(request, 'period-60d-open')
      setTicketInDb(oldOpen.id, { createdAt: new Date(now - 60 * DAY) })
      await finished('period-60d-ai', 60, 5, 'resolved', true)
      await finished('period-200d-ai', 200, 7, 'closed', true)

      await signInViaApi(request, AGENT)
      expect(await getCounts(request, '7d')).toEqual({ total: 2, open: 2, resolvedByAi: 1, averageResolutionMs: 1 * HOUR })
      expect(await getCounts(request, '30d')).toEqual({ total: 3, open: 2, resolvedByAi: 1, averageResolutionMs: 2 * HOUR })
      expect(await getCounts(request, '90d')).toEqual({ total: 5, open: 2, resolvedByAi: 2, averageResolutionMs: 3 * HOUR })
      const all = await getCounts(request, 'all')
      expect(all).toEqual({ total: 6, open: 2, resolvedByAi: 3, averageResolutionMs: 4 * HOUR })
      expect(await getCounts(request)).toEqual(all)
    })

    test('an open ticket created long ago counts in open for every period, including 7d', async ({ request }) => {
      const ticket = await createTicketViaWebhook(request, 'period-old-open')
      setTicketInDb(ticket.id, { createdAt: new Date(Date.now() - 60 * DAY) })

      await signInViaApi(request, ADMIN)
      for (const period of ['7d', '30d']) {
        expect(await getCounts(request, period)).toEqual({ total: 0, open: 1, resolvedByAi: 0, averageResolutionMs: null })
      }
      for (const period of ['90d', 'all']) {
        expect(await getCounts(request, period)).toEqual({ total: 1, open: 1, resolvedByAi: 0, averageResolutionMs: null })
      }
    })

    test('a period goes by createdAt, not resolvedAt: a ticket created 10 days ago and resolved yesterday is outside 7d and inside 30d', async ({ request }) => {
      const now = Date.now()
      const ticket = await createTicketViaWebhook(request, 'period-late-resolve')
      setTicketInDb(ticket.id, { status: 'resolved', createdAt: new Date(now - 10 * DAY), resolvedAt: new Date(now - DAY) })
      addAiReplyInDb(ticket.id, 'Resolved by the AI yesterday.')

      await signInViaApi(request, AGENT)
      expect(await getCounts(request, '7d')).toEqual({ total: 0, open: 0, resolvedByAi: 0, averageResolutionMs: null })
      expect(await getCounts(request, '30d')).toEqual({ total: 1, open: 0, resolvedByAi: 1, averageResolutionMs: 9 * DAY })
    })
  })
})

// ?tz= is the viewer's IANA time zone (default UTC): the periods start at midnight in it, and
// ticketsPerDay buckets createdAt by its calendar day there.
test.describe('GET /api/tickets/stats: tz', () => {
  // 'Mars/Base' and 'not a zone' aren't zones; the last is 65 characters, one over the limit.
  for (const tz of ['Mars/Base', 'not a zone', '', `Europe/${'x'.repeat(58)}`]) {
    test(`tz=${JSON.stringify(tz.length > 20 ? `${tz.slice(0, 12)}… (${tz.length} chars)` : tz)} gets 400`, async ({ request }) => {
      await signInViaApi(request, AGENT)
      const res = await request.get('/api/tickets/stats', { params: { tz } })
      expect(res.status()).toBe(400)
      expect(await res.json()).toEqual({ error: TZ_ERROR })
    })
  }

  test('a repeated tz param gets 400', async ({ request }) => {
    await signInViaApi(request, AGENT)
    const res = await request.get('/api/tickets/stats?tz=UTC&tz=Europe/Warsaw')
    expect(res.status()).toBe(400)
    expect(await res.json()).toEqual({ error: TZ_ERROR })
  })

  test('401 without a session, even with an invalid tz', async ({ request }) => {
    const res = await request.get('/api/tickets/stats', { params: { tz: 'Mars/Base' } })
    expect(res.status()).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  test('IANA zones are accepted with every period, including a lower-case name and a 45-minute offset', async ({ request }) => {
    await signInViaApi(request, ADMIN)
    for (const tz of ['UTC', 'Europe/Warsaw', 'America/Los_Angeles', 'Asia/Kathmandu', 'europe/warsaw']) {
      for (const period of ['7d', 'all']) await getStats(request, { period, tz })
    }
  })

  test.describe('counts', () => {
    test('a ticket at 23:30 UTC lands on the next day in Europe/Warsaw and Asia/Tokyo, and on its UTC day by default or with tz=UTC', async ({ request }) => {
      await signInViaApi(request, AGENT)
      const zones = ['UTC', 'Europe/Warsaw', 'Asia/Tokyo']
      const { today, result } = await onStableDays(zones, async (today) => {
        deleteAllTicketsInDb()
        const ticket = await createTicketViaWebhook(request, 'tz-late-utc')
        setTicketInDb(ticket.id, { createdAt: new Date(`${addDays(today.UTC!, -2)}T23:30:00Z`) })
        const byZone: Record<string, TicketStats> = { default: await getStats(request, { period: '7d' }) }
        for (const tz of zones) byZone[tz] = await getStats(request, { period: '7d', tz })
        return byZone
      })

      const utcDay = addDays(today.UTC!, -2)
      for (const key of ['default', 'UTC']) {
        const days = result[key]!.ticketsPerDay
        expect(countOn(days, utcDay), `${key}: ${utcDay}`).toBe(1)
        expect(countOn(days, addDays(utcDay, 1)), `${key}: the next day`).toBe(0)
      }
      for (const tz of ['Europe/Warsaw', 'Asia/Tokyo']) {
        const days = result[tz]!.ticketsPerDay
        expect(countOn(days, utcDay), `${tz}: ${utcDay}`).toBe(0)
        expect(countOn(days, addDays(utcDay, 1)), `${tz}: the next day`).toBe(1)
      }
      for (const stats of Object.values(result)) expect(stats.total).toBe(1)
    })

    test('the period starts at midnight in tz: in Asia/Tokyo, 00:30 six days ago is in 7d and 23:30 the day before is not; in UTC both fall on one day, so 7d has both or neither', async ({ request }) => {
      await signInViaApi(request, AGENT)
      const tz = 'Asia/Tokyo'
      const { today, result } = await onStableDays(['UTC', tz], async (today) => {
        deleteAllTicketsInDb()
        const inside = await createTicketViaWebhook(request, 'tz-since-inside')
        const outside = await createTicketViaWebhook(request, 'tz-since-outside')
        setTicketInDb(inside.id, { createdAt: new Date(atLocal(addDays(today[tz]!, -6), '00:30', tz)) })
        setTicketInDb(outside.id, { createdAt: new Date(atLocal(addDays(today[tz]!, -7), '23:30', tz)) })
        return { zone: await getStats(request, { period: '7d', tz }), utc: await getStats(request, { period: '7d' }) }
      })

      const first = addDays(today[tz]!, -6)
      expect(result.zone.total).toBe(1)
      expect(result.zone.ticketsPerDay[0]).toEqual({ date: first, count: 1 })
      expect(result.zone.ticketsPerDay).toHaveLength(7)

      // Both tickets are on the same UTC day (14:30 and 15:30 UTC); whether it's inside UTC's 7d
      // depends on the time of day, so the test works out which.
      const utcDay = dateIn('UTC', atLocal(first, '00:30', tz))
      const expected = utcDay >= addDays(today.UTC!, -6) ? 2 : 0
      expect(result.utc.total).toBe(expected)
      expect(sumOf(result.utc.ticketsPerDay)).toBe(expected)
    })

    // Postgres reads an offset like '+09:00' as a POSIX zone, where positive means west of
    // Greenwich (UTC-9), while Intl.DateTimeFormat accepts it as UTC+9. Either refuse it or bucket
    // it like Asia/Tokyo.
    test('an offset tz (+09:00), which Intl accepts, gets 400 or the same days as Asia/Tokyo', async ({ request }) => {
      await signInViaApi(request, AGENT)
      const { today, result } = await onStableDays(['UTC'], async (today) => {
        deleteAllTicketsInDb()
        const ticket = await createTicketViaWebhook(request, 'tz-offset')
        setTicketInDb(ticket.id, { createdAt: new Date(`${addDays(today.UTC!, -2)}T23:30:00Z`) })
        const res = await request.get('/api/tickets/stats', { params: { period: 'all', tz: '+09:00' } })
        return { status: res.status(), body: await res.json() }
      })

      if (result.status === 400) {
        expect(result.body).toEqual({ error: TZ_ERROR })
      } else {
        expect(result.status).toBe(200)
        const days = (result.body as TicketStats).ticketsPerDay
        expect(days[0]).toEqual({ date: addDays(today.UTC!, -1), count: 1 })
      }
    })
  })
})

// ticketsPerDay: every calendar day (in tz) from the period's first day, or for `all` the earliest
// ticket's day, through today, oldest first, zeros included, counting every ticket by createdAt
// whatever its status, so the counts add up to total. Tickets placed in the past sit at noon UTC
// (or in tz), hours from any day boundary; each test runs inside onStableDays so a midnight
// during the test can't shift "today".
test.describe('GET /api/tickets/stats: ticketsPerDay', () => {
  test('with no tickets, all has no days and 7d has 7 zero days ending today', async ({ request }) => {
    await signInViaApi(request, AGENT)
    const tz = 'Asia/Tokyo'
    const { today, result } = await onStableDays(['UTC', tz], async () => {
      deleteAllTicketsInDb()
      return {
        all: await getStats(request, { period: 'all' }),
        allInZone: await getStats(request, { period: 'all', tz }),
        week: await getStats(request, { period: '7d' }),
        weekInZone: await getStats(request, { period: '7d', tz }),
      }
    })

    expect(result.all.ticketsPerDay).toEqual([])
    expect(result.allInZone.ticketsPerDay).toEqual([])
    const zeros = (last: string) => datesFrom(addDays(last, -6), last).map((date) => ({ date, count: 0 }))
    expect(result.week).toMatchObject({ total: 0, ticketsPerDay: zeros(today.UTC!) })
    expect(result.weekInZone).toMatchObject({ total: 0, ticketsPerDay: zeros(today[tz]!) })
  })

  // Kiritimati (UTC+14) and Pago Pago (UTC-11) are always on different dates, so at least one of
  // them differs from UTC whenever the test runs.
  for (const tz of [undefined, 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
    test(`7d, 30d and 90d list exactly 7, 30 and 90 consecutive days ending today${tz ? ` in ${tz}` : ' in UTC by default'}`, async ({ request }) => {
      await signInViaApi(request, AGENT)
      const zone = tz ?? 'UTC'
      const { today, result } = await onStableDays([zone], async () => {
        deleteAllTicketsInDb()
        await createTicketViaWebhook(request, 'per-day-length')
        const byPeriod: Record<string, TicketStats> = {}
        for (const period of ['7d', '30d', '90d']) byPeriod[period] = await getStats(request, tz ? { period, tz } : { period })
        return byPeriod
      })

      for (const [period, days] of [['7d', 7], ['30d', 30], ['90d', 90]] as const) {
        const stats = result[period]!
        expect(stats.ticketsPerDay.map((day) => day.date), period).toEqual(datesFrom(addDays(today[zone]!, 1 - days), today[zone]!))
        expect(countOn(stats.ticketsPerDay, today[zone]!), `${period}: today`).toBe(1)
        expect(stats.total, period).toBe(1)
      }
    })
  }

  test('counts tickets of any status on their days, fills empty days with zeros, and leaves out days before the period', async ({ request }) => {
    await signInViaApi(request, AGENT)
    const { today, result } = await onStableDays(['UTC'], async (today) => {
      deleteAllTicketsInDb()
      const place = async (label: string, daysAgo: number, status?: string) => {
        const ticket = await createTicketViaWebhook(request, label)
        setTicketInDb(ticket.id, { createdAt: noonUtc(addDays(today.UTC!, -daysAgo)), ...(status ? { status } : {}) })
      }
      await createTicketViaWebhook(request, 'per-day-today')
      await place('per-day-1-new', 1, 'new')
      await place('per-day-1-processing', 1, 'processing')
      await place('per-day-4-closed', 4, 'closed')
      await place('per-day-8', 8, 'resolved')
      return { week: await getStats(request, { period: '7d' }), month: await getStats(request, { period: '30d' }) }
    })

    const t = today.UTC!
    expect(result.week.ticketsPerDay).toEqual([
      { date: addDays(t, -6), count: 0 },
      { date: addDays(t, -5), count: 0 },
      { date: addDays(t, -4), count: 1 },
      { date: addDays(t, -3), count: 0 },
      { date: addDays(t, -2), count: 0 },
      { date: addDays(t, -1), count: 2 },
      { date: t, count: 1 },
    ])
    expect(result.week.total).toBe(4)
    expect(countOn(result.month.ticketsPerDay, addDays(t, -8))).toBe(1)
    expect(sumOf(result.month.ticketsPerDay)).toBe(5)
    expect(result.month.total).toBe(5)
  })

  test('the days sum to total for every period; all runs from the earliest ticket\'s day (in tz) through today', async ({ request }) => {
    await signInViaApi(request, AGENT)
    const tz = 'Asia/Tokyo'
    const { today, result } = await onStableDays(['UTC', tz], async (today) => {
      deleteAllTicketsInDb()
      await createTicketViaWebhook(request, 'per-day-sum-today')
      for (const daysAgo of [1, 3, 20, 60]) {
        const ticket = await createTicketViaWebhook(request, `per-day-sum-${daysAgo}`)
        setTicketInDb(ticket.id, { createdAt: noonUtc(addDays(today.UTC!, -daysAgo)) })
      }
      // The earliest ticket, at 23:30 UTC: the next day in Tokyo.
      const earliest = await createTicketViaWebhook(request, 'per-day-sum-earliest')
      setTicketInDb(earliest.id, { createdAt: new Date(`${addDays(today.UTC!, -200)}T23:30:00Z`) })
      const stats: Record<string, TicketStats> = {}
      for (const period of ['7d', '30d', '90d', 'all']) stats[period] = await getStats(request, { period })
      stats.allInZone = await getStats(request, { period: 'all', tz })
      return stats
    })

    const expectedTotals: Record<string, number> = { '7d': 3, '30d': 4, '90d': 5, all: 6, allInZone: 6 }
    for (const [key, total] of Object.entries(expectedTotals)) {
      expect(result[key]!.total, key).toBe(total)
      expect(sumOf(result[key]!.ticketsPerDay), key).toBe(total)
    }
    const earliestDay = addDays(today.UTC!, -200)
    expect(result.all!.ticketsPerDay.map((day) => day.date)).toEqual(datesFrom(earliestDay, today.UTC!))
    expect(result.all!.ticketsPerDay[0]).toEqual({ date: earliestDay, count: 1 })
    expect(result.allInZone!.ticketsPerDay.map((day) => day.date)).toEqual(datesFrom(addDays(earliestDay, 1), today[tz]!))
    expect(result.allInZone!.ticketsPerDay[0]).toEqual({ date: addDays(earliestDay, 1), count: 1 })
  })
})

test.describe('GET /api/tickets/stats: averageResolutionMs', () => {
  test.beforeEach(() => deleteAllTicketsInDb())

  test('null when no finished ticket has a resolvedAt: open, new and processing tickets, a resolved one without resolvedAt, and an open one with a stale resolvedAt are ignored', async ({ request }) => {
    const now = Date.now()
    await createTicketViaWebhook(request, 'avg-open')
    const created = await createTicketViaWebhook(request, 'avg-new')
    const processing = await createTicketViaWebhook(request, 'avg-processing')
    const resolvedNoTime = await createTicketViaWebhook(request, 'avg-resolved-no-time')
    const openWithTime = await createTicketViaWebhook(request, 'avg-open-with-time')
    setTicketStatusInDb(created.id, 'new')
    setTicketStatusInDb(processing.id, 'processing')
    setTicketInDb(resolvedNoTime.id, { status: 'resolved', resolvedAt: null })
    setTicketInDb(openWithTime.id, { createdAt: new Date(now - 2 * HOUR), resolvedAt: new Date(now - HOUR) })

    await signInViaApi(request, AGENT)
    expect(await getCounts(request)).toEqual({ total: 5, open: 2, resolvedByAi: 0, averageResolutionMs: null })
  })

  test('the mean of resolvedAt - createdAt over resolved and closed tickets, in ms', async ({ request }) => {
    const now = Date.now()
    const resolved = await createTicketViaWebhook(request, 'avg-resolved')
    const closed = await createTicketViaWebhook(request, 'avg-closed')
    const ignored = await createTicketViaWebhook(request, 'avg-ignored-open')
    // 1 hour and 3 hours: the mean is 2 hours.
    setTicketInDb(resolved.id, { status: 'resolved', createdAt: new Date(now - 3 * HOUR), resolvedAt: new Date(now - 2 * HOUR) })
    setTicketInDb(closed.id, { status: 'closed', createdAt: new Date(now - 5 * HOUR), resolvedAt: new Date(now - 2 * HOUR) })
    setTicketInDb(ignored.id, { createdAt: new Date(now - 100 * HOUR) })

    await signInViaApi(request, ADMIN)
    expect(await averageOf(request)).toBe(2 * HOUR)
  })
})

// PATCH /api/tickets/:id stamps resolvedAt when a ticket becomes resolved or closed, keeps it when
// it moves between those two (or the status isn't changed), and clears it when it's reopened.
test.describe('PATCH /api/tickets/:id: resolvedAt, seen through the stats average', () => {
  test.beforeEach(() => deleteAllTicketsInDb())

  // The average is the server's now minus the ticket's createdAt; the bounds allow 1 s of slack.
  async function expectStampedBetween(request: APIRequestContext, createdAt: Date, before: number, after: number) {
    const average = await averageOf(request)
    expect(average).not.toBeNull()
    expect(average!).toBeGreaterThanOrEqual(before - createdAt.getTime() - 1000)
    expect(average!).toBeLessThanOrEqual(after - createdAt.getTime() + 1000)
  }

  for (const status of ['resolved', 'closed']) {
    test(`open -> ${status} stamps resolvedAt with the time of the PATCH`, async ({ request }) => {
      const ticket = await createTicketViaWebhook(request, `patch-${status}`)
      const createdAt = new Date(Date.now() - HOUR)
      setTicketInDb(ticket.id, { createdAt })
      await signInViaApi(request, AGENT)
      expect(await averageOf(request)).toBeNull()

      const before = Date.now()
      await updateTicketViaApi(request, ticket.id, { status })
      const after = Date.now()

      await expectStampedBetween(request, createdAt, before, after)
    })
  }

  test('resolved -> closed -> resolved keeps the original resolvedAt', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'patch-keep')
    const createdAt = new Date(Date.now() - 2 * HOUR)
    setTicketInDb(ticket.id, { createdAt })
    await signInViaApi(request, AGENT)
    await updateTicketViaApi(request, ticket.id, { status: 'resolved' })
    // Move the stamp to a known time, so any re-stamp would show as ~2 hours.
    setTicketInDb(ticket.id, { resolvedAt: new Date(createdAt.getTime() + 60_000) })
    expect(await averageOf(request)).toBe(60_000)

    await updateTicketViaApi(request, ticket.id, { status: 'closed' })
    expect(await averageOf(request)).toBe(60_000)

    await updateTicketViaApi(request, ticket.id, { status: 'resolved' })
    expect(await averageOf(request)).toBe(60_000)
  })

  test('a PATCH without a status change keeps resolvedAt: same status again, or only the category or assignee', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'patch-no-status')
    const createdAt = new Date(Date.now() - 2 * HOUR)
    setTicketInDb(ticket.id, { createdAt })
    await signInViaApi(request, ADMIN)
    await updateTicketViaApi(request, ticket.id, { status: 'resolved' })
    setTicketInDb(ticket.id, { resolvedAt: new Date(createdAt.getTime() + 60_000) })

    await updateTicketViaApi(request, ticket.id, { status: 'resolved' })
    expect(await averageOf(request)).toBe(60_000)
    await updateTicketViaApi(request, ticket.id, { category: 'refund_request' })
    expect(await averageOf(request)).toBe(60_000)
    await updateTicketViaApi(request, ticket.id, { assignedToId: null })
    expect(await averageOf(request)).toBe(60_000)
  })

  test('resolved -> open clears resolvedAt; resolving again stamps a new time', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'patch-reopen')
    const createdAt = new Date(Date.now() - 2 * HOUR)
    setTicketInDb(ticket.id, { createdAt })
    await signInViaApi(request, AGENT)
    await updateTicketViaApi(request, ticket.id, { status: 'resolved' })
    setTicketInDb(ticket.id, { resolvedAt: new Date(createdAt.getTime() + 60_000) })
    expect(await averageOf(request)).toBe(60_000)

    await updateTicketViaApi(request, ticket.id, { status: 'open' })
    expect(await getCounts(request)).toMatchObject({ open: 1, averageResolutionMs: null })

    const before = Date.now()
    await updateTicketViaApi(request, ticket.id, { status: 'resolved' })
    const after = Date.now()
    await expectStampedBetween(request, createdAt, before, after)
  })

  test('closed -> open clears resolvedAt', async ({ request }) => {
    const ticket = await createTicketViaWebhook(request, 'patch-reopen-closed')
    await signInViaApi(request, AGENT)
    await updateTicketViaApi(request, ticket.id, { status: 'closed' })
    expect(await averageOf(request)).not.toBeNull()

    await updateTicketViaApi(request, ticket.id, { status: 'open' })
    expect(await averageOf(request)).toBeNull()
  })
})

test.describe('webhook threading: resolvedAt, seen through the stats', () => {
  test.beforeEach(() => deleteAllTicketsInDb())

  test('a customer reply that reopens an AI-resolved ticket removes it from the average and from resolvedByAi', async ({ request }) => {
    const messageId = `<stats-thread-${uniqueSuffix()}@example.com>`
    const ticket = await createTicketViaWebhook(request, 'stats-thread', { messageId })
    setTicketInDb(ticket.id, { status: 'resolved', createdAt: new Date(Date.now() - 2 * HOUR), resolvedAt: new Date(Date.now() - HOUR) })
    addAiReplyInDb(ticket.id, 'Answered from the knowledge base.')
    await signInViaApi(request, AGENT)
    expect(await getCounts(request)).toMatchObject({ total: 1, open: 0, resolvedByAi: 1 })
    expect(await averageOf(request)).not.toBeNull()

    const suffix = uniqueSuffix()
    const res = await request.post('/api/webhooks/inbound-email', {
      headers: { 'X-Inbound-Secret': inboundSecret() },
      data: {
        senderEmail: `customer-${suffix}@example.com`,
        senderName: `Customer ${suffix}`,
        subject: `Re: ${ticket.subject}`,
        body: 'That did not fix it.',
        messageId: `<stats-reply-${suffix}@example.com>`,
        inReplyTo: messageId,
      },
    })
    expect(res.status()).toBe(201)
    expect(await res.json()).toEqual({ ticket: { id: ticket.id }, reply: { id: expect.any(Number) } })

    expect(await getCounts(request)).toEqual({ total: 1, open: 1, resolvedByAi: 0, averageResolutionMs: null })
  })
})
