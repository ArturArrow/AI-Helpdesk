import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axios, { AxiosError } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpError } from '@/test/http.ts'
import { renderWithQuery } from '@/test/render.tsx'
import TicketSummary from './TicketSummary.tsx'

const summary = 'Rita wants a refund for order 1234. Alan has asked for the receipt.'

function region() {
  return screen.getByRole('region', { name: 'Summary' })
}

function summarizeButton() {
  return screen.getByRole('button', { name: 'Summarize' })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TicketSummary', () => {
  it('shows only the Summarize button and sends nothing until it is clicked', () => {
    const post = vi.spyOn(axios, 'post')
    renderWithQuery(<TicketSummary ticket={{ id: 42 }} />)

    expect(within(region()).getByRole('button', { name: 'Summarize' })).toBeEnabled()
    expect(region().textContent).toBe('Summarize')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })

  it('posts to the ticket\'s summary endpoint and disables the button while pending', async () => {
    const user = userEvent.setup()
    let resolve!: (value: { data: { summary: string } }) => void
    const post = vi.spyOn(axios, 'post').mockReturnValue(new Promise((r) => (resolve = r)))
    renderWithQuery(<TicketSummary ticket={{ id: 42 }} />)

    await user.click(summarizeButton())

    expect(post).toHaveBeenCalledExactlyOnceWith('/api/tickets/42/summary')
    await waitFor(() => expect(summarizeButton()).toBeDisabled())

    resolve({ data: { summary } })
    await waitFor(() => expect(summarizeButton()).toBeEnabled())
  })

  it('shows the returned summary as plain text inside the Summary region', async () => {
    const user = userEvent.setup()
    const html = '<b>Refund</b> requested'
    vi.spyOn(axios, 'post').mockResolvedValue({ data: { summary: html } })
    renderWithQuery(<TicketSummary ticket={{ id: 42 }} />)

    await user.click(summarizeButton())

    expect(await within(region()).findByText(html)).toBeInTheDocument()
    // Rendered as HTML, the tag would become a <b> element holding just "Refund".
    expect(screen.queryByText('Refund')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('requests a fresh summary on every click and replaces the previous one', async () => {
    const user = userEvent.setup()
    const updated = 'Alan has refunded the order and closed the ticket.'
    const post = vi
      .spyOn(axios, 'post')
      .mockResolvedValueOnce({ data: { summary } })
      .mockResolvedValueOnce({ data: { summary: updated } })
    renderWithQuery(<TicketSummary ticket={{ id: 42 }} />)

    await user.click(summarizeButton())
    await within(region()).findByText(summary)
    await waitFor(() => expect(summarizeButton()).toBeEnabled())
    await user.click(summarizeButton())

    expect(await within(region()).findByText(updated)).toBeInTheDocument()
    expect(screen.queryByText(summary)).not.toBeInTheDocument()
    expect(post).toHaveBeenCalledTimes(2)
    expect(post).toHaveBeenNthCalledWith(2, '/api/tickets/42/summary')
  })

  it('shows an alert with the HTTP status when the request fails', async () => {
    const user = userEvent.setup()
    vi.spyOn(axios, 'post').mockRejectedValue(httpError(503, { error: 'AI is not configured' }))
    renderWithQuery(<TicketSummary ticket={{ id: 42 }} />)

    await user.click(summarizeButton())

    const alert = await within(region()).findByRole('alert')
    expect(alert.textContent).toBe("Couldn't summarize the ticket: Request failed (503)")
    expect(summarizeButton()).toBeEnabled()
  })

  it('shows a generic alert when the request fails without a response', async () => {
    const user = userEvent.setup()
    vi.spyOn(axios, 'post').mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK'))
    renderWithQuery(<TicketSummary ticket={{ id: 42 }} />)

    await user.click(summarizeButton())

    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't summarize the ticket: Request failed")
  })
})
