import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axios from 'axios'
import { ReplySender } from 'core/constants/replySender'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpError } from '@/test/http.ts'
import { renderWithQuery } from '@/test/render.tsx'
import ReplyForm from './ReplyForm.tsx'

const reply = {
  id: 7,
  body: 'We have refunded your order.',
  sender: ReplySender.agent,
  createdAt: '2026-04-05T08:00:00.000Z',
  author: { id: 'user-2', name: 'Alan Agent' },
}

function textarea() {
  return screen.getByRole('textbox', { name: 'Reply' })
}

function sendButton() {
  return screen.getByRole('button', { name: 'Send reply' })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ReplyForm', () => {
  it('shows "Reply can\'t be empty" and sends nothing when submitted empty', async () => {
    const user = userEvent.setup()
    const post = vi.spyOn(axios, 'post')
    renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

    await user.click(sendButton())

    expect((await screen.findByRole('alert')).textContent).toBe("Reply can't be empty")
    expect(textarea()).toHaveAttribute('aria-invalid', 'true')
    expect(post).not.toHaveBeenCalled()
  })

  it('treats a whitespace-only reply as empty', async () => {
    const user = userEvent.setup()
    const post = vi.spyOn(axios, 'post')
    renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

    await user.type(textarea(), '   \n  ')
    await user.click(sendButton())

    expect((await screen.findByRole('alert')).textContent).toBe("Reply can't be empty")
    expect(post).not.toHaveBeenCalled()
  })

  it('rejects a reply over 10,000 characters', async () => {
    const user = userEvent.setup()
    const post = vi.spyOn(axios, 'post')
    renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

    await user.click(textarea())
    await user.paste('a'.repeat(10_001))
    await user.click(sendButton())

    expect((await screen.findByRole('alert')).textContent).toBe('Reply is too long')
    expect(post).not.toHaveBeenCalled()
  })

  it('posts the trimmed body to the ticket and clears the field', async () => {
    const user = userEvent.setup()
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ status: 201, data: { reply } })
    renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

    expect(textarea()).toHaveAttribute('aria-invalid', 'false')
    await user.type(textarea(), `  ${reply.body}  `)
    await user.click(sendButton())

    expect(post).toHaveBeenCalledExactlyOnceWith('/api/tickets/42/replies', { body: reply.body })
    await waitFor(() => expect(textarea()).toHaveValue(''))
    expect(sendButton()).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('disables the button while the reply is being sent', async () => {
    const user = userEvent.setup()
    vi.spyOn(axios, 'post').mockReturnValue(new Promise(() => {}))
    renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)
    expect(sendButton()).toBeEnabled()

    await user.type(textarea(), reply.body)
    await user.click(sendButton())

    await waitFor(() => expect(sendButton()).toBeDisabled())
    // The text stays until the server has accepted it.
    expect(textarea()).toHaveValue(reply.body)
  })

  it('shows an alert with the HTTP status and keeps the text when sending fails', async () => {
    const user = userEvent.setup()
    vi.spyOn(axios, 'post').mockRejectedValue(httpError(500))
    renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

    await user.type(textarea(), reply.body)
    await user.click(sendButton())

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe("Couldn't send the reply: Request failed (500)")
    expect(textarea()).toHaveValue(reply.body)
    expect(sendButton()).toBeEnabled()
  })
})
