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

function polishButton() {
  return screen.getByRole('button', { name: 'Polish' })
}

const draft = 'we refunded it, sorry'
const polished = 'We have refunded your order. Sorry for the trouble.'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ReplyForm', () => {
  it('disables "Send reply" while the field is empty, and Cmd+Enter sends nothing', async () => {
    const user = userEvent.setup()
    const post = vi.spyOn(axios, 'post')
    renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

    expect(sendButton()).toBeDisabled()
    await user.click(textarea())
    await user.keyboard('{Meta>}{Enter}{/Meta}')

    // Blank is blocked by the disabled button, not reported as a validation error.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(textarea()).toHaveAttribute('aria-invalid', 'false')
    expect(post).not.toHaveBeenCalled()
  })

  it('keeps "Send reply" disabled for a whitespace-only reply until real text is typed', async () => {
    const user = userEvent.setup()
    const post = vi.spyOn(axios, 'post')
    renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

    await user.type(textarea(), '   \n  ')
    expect(sendButton()).toBeDisabled()
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()

    await user.type(textarea(), 'Hi')
    expect(sendButton()).toBeEnabled()
  })

  it('disables "Send reply" again when the text is deleted back to empty', async () => {
    const user = userEvent.setup()
    renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

    await user.type(textarea(), 'Hi')
    expect(sendButton()).toBeEnabled()
    await user.type(textarea(), '{Backspace}{Backspace}')

    expect(textarea()).toHaveValue('')
    expect(sendButton()).toBeDisabled()
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
    // The cleared field is blank, so there is nothing to send until the next reply is typed.
    expect(sendButton()).toBeDisabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('disables the button while the reply is being sent', async () => {
    const user = userEvent.setup()
    vi.spyOn(axios, 'post').mockReturnValue(new Promise(() => {}))
    renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

    await user.type(textarea(), reply.body)
    expect(sendButton()).toBeEnabled()
    await user.click(sendButton())

    // Disabled by the pending request, with text still in the field.
    await waitFor(() => expect(sendButton()).toBeDisabled())
    expect(polishButton()).toBeDisabled()
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

  describe('Polish', () => {
    it('sends the draft to the polish endpoint and replaces the text with the result', async () => {
      const user = userEvent.setup()
      const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: { body: polished } })
      renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

      await user.type(textarea(), draft)
      await user.click(polishButton())

      await waitFor(() => expect(textarea()).toHaveValue(polished))
      // Only the polish request: nothing is sent as a reply.
      expect(post).toHaveBeenCalledExactlyOnceWith('/api/tickets/42/replies/polish', { body: draft })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('shows "Reply can\'t be empty" and sends nothing for an empty draft', async () => {
      const user = userEvent.setup()
      const post = vi.spyOn(axios, 'post')
      renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

      await user.click(polishButton())

      expect((await screen.findByRole('alert')).textContent).toBe("Reply can't be empty")
      expect(textarea()).toHaveAttribute('aria-invalid', 'true')
      expect(post).not.toHaveBeenCalled()
    })

    it('treats a whitespace-only draft as empty', async () => {
      const user = userEvent.setup()
      const post = vi.spyOn(axios, 'post')
      renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

      await user.type(textarea(), '   \n  ')
      await user.click(polishButton())

      expect((await screen.findByRole('alert')).textContent).toBe("Reply can't be empty")
      expect(post).not.toHaveBeenCalled()
    })

    it('disables both buttons while polishing and re-enables them afterwards', async () => {
      const user = userEvent.setup()
      let resolve!: (value: { data: { body: string } }) => void
      vi.spyOn(axios, 'post').mockReturnValue(new Promise((r) => (resolve = r)))
      renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

      await user.type(textarea(), draft)
      await user.click(polishButton())

      await waitFor(() => expect(polishButton()).toBeDisabled())
      expect(sendButton()).toBeDisabled()

      resolve({ data: { body: polished } })

      await waitFor(() => expect(polishButton()).toBeEnabled())
      expect(sendButton()).toBeEnabled()
      expect(textarea()).toHaveValue(polished)
    })

    it('shows an alert with the HTTP status and keeps the draft when polishing fails', async () => {
      const user = userEvent.setup()
      vi.spyOn(axios, 'post').mockRejectedValue(httpError(503, { error: "AI isn't configured" }))
      renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

      await user.type(textarea(), draft)
      await user.click(polishButton())

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toBe("Couldn't polish the reply: Request failed (503)")
      expect(textarea()).toHaveValue(draft)
      expect(polishButton()).toBeEnabled()
    })

    it('sends the polished text with "Send reply"', async () => {
      const user = userEvent.setup()
      const post = vi
        .spyOn(axios, 'post')
        .mockResolvedValueOnce({ data: { body: polished } })
        .mockResolvedValueOnce({ status: 201, data: { reply: { ...reply, body: polished } } })
      renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

      await user.type(textarea(), draft)
      await user.click(polishButton())
      await waitFor(() => expect(textarea()).toHaveValue(polished))
      await user.click(sendButton())

      expect(post).toHaveBeenLastCalledWith('/api/tickets/42/replies', { body: polished })
      expect(post).toHaveBeenCalledTimes(2)
      await waitFor(() => expect(textarea()).toHaveValue(''))
    })
  })
})
