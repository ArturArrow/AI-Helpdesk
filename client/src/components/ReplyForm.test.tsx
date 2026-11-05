import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axios from 'axios'
import { MAX_ATTACHMENT_BYTES, MAX_REPLY_ATTACHMENT_BYTES, MAX_REPLY_ATTACHMENTS } from 'core/constants/attachment'
import { ReplySender } from 'core/constants/replySender'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpError } from '@/test/http.ts'
import { renderWithQuery } from '@/test/render.tsx'
import ReplyForm from './ReplyForm.tsx'
import type { Reply } from './ReplyThread.tsx'

const reply: Reply = {
  id: 7,
  body: 'We have refunded your order.',
  bodyHTML: null,
  sender: ReplySender.agent,
  emailStatus: null,
  createdAt: '2026-04-05T08:00:00.000Z',
  author: { id: 'user-2', name: 'Alan Agent' },
  attachments: [],
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

function attachButton() {
  return screen.getByRole('button', { name: 'Attach files' })
}

// The input is hidden, so it has no role; the "Attach files" button is what a user reaches.
function fileInput() {
  return screen.getByLabelText<HTMLInputElement>('Files to attach')
}

function removeButton(name: string) {
  return screen.getByRole('button', { name: `Remove ${name}` })
}

// The text of each row in the list of files to send, e.g. 'notes.txt (5 B)'.
function filesToSend() {
  const list = screen.queryByRole('list', { name: 'Files to send' })
  return list ? within(list).getAllByRole('listitem').map((item) => item.textContent) : []
}

// The form of the latest request; axios.post is a spy in every test that reads it.
function sentForm() {
  return vi.mocked(axios.post).mock.lastCall![1] as FormData
}

// A file that reports `size` without allocating it.
function fileOfSize(name: string, size: number) {
  const file = new File(['x'], name)
  Object.defineProperty(file, 'size', { value: size })
  return file
}

const notes = new File(['hello'], 'notes.txt')
const logs = new File(['x'.repeat(2048)], 'logs.txt')
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

    expect(post).toHaveBeenCalledExactlyOnceWith('/api/tickets/42/replies', expect.any(FormData))
    expect(sentForm().get('body')).toBe(reply.body)
    await waitFor(() => expect(textarea()).toHaveValue(''))
    // The cleared field is blank, so there is nothing to send or polish until the next reply is typed.
    expect(sendButton()).toBeDisabled()
    expect(polishButton()).toBeDisabled()
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

    it('disables "Polish" while the draft is empty, and clicking it sends nothing', async () => {
      const user = userEvent.setup()
      const post = vi.spyOn(axios, 'post')
      renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

      expect(polishButton()).toBeDisabled()
      await user.click(polishButton())

      // Blank is blocked by the disabled button, not reported as a validation error.
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(textarea()).toHaveAttribute('aria-invalid', 'false')
      expect(post).not.toHaveBeenCalled()
    })

    it('keeps "Polish" disabled for a whitespace-only draft until real text is typed', async () => {
      const user = userEvent.setup()
      const post = vi.spyOn(axios, 'post')
      renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

      await user.type(textarea(), '   \n  ')
      expect(polishButton()).toBeDisabled()
      await user.click(polishButton())
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(post).not.toHaveBeenCalled()

      await user.type(textarea(), 'Hi')
      expect(polishButton()).toBeEnabled()
    })

    it('disables "Polish" again when the text is deleted back to empty', async () => {
      const user = userEvent.setup()
      const post = vi.spyOn(axios, 'post')
      renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

      await user.type(textarea(), 'Hi')
      expect(polishButton()).toBeEnabled()
      await user.type(textarea(), '{Backspace}{Backspace}')

      expect(textarea()).toHaveValue('')
      expect(polishButton()).toBeDisabled()
      await user.click(polishButton())
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

      expect(post).toHaveBeenLastCalledWith('/api/tickets/42/replies', expect.any(FormData))
      expect(sentForm().get('body')).toBe(polished)
      expect(post).toHaveBeenCalledTimes(2)
      await waitFor(() => expect(textarea()).toHaveValue(''))
    })
  })

  describe('attachments', () => {
    it('opens the file input from "Attach files" without sending anything', async () => {
      const user = userEvent.setup()
      const post = vi.spyOn(axios, 'post')
      renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)
      const click = vi.spyOn(fileInput(), 'click')

      await user.type(textarea(), draft)
      await user.click(attachButton())

      expect(click).toHaveBeenCalledOnce()
      expect(post).not.toHaveBeenCalled()
    })

    it('shows no file list before anything is chosen', () => {
      renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

      expect(screen.queryByRole('list', { name: 'Files to send' })).not.toBeInTheDocument()
    })

    it('lists several files chosen at once, with their sizes', async () => {
      const user = userEvent.setup()
      renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

      await user.upload(fileInput(), [notes, logs])

      expect(filesToSend()).toEqual(['notes.txt (5 B)', 'logs.txt (2 KB)'])
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('adds a second choice to the first', async () => {
      const user = userEvent.setup()
      renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

      await user.upload(fileInput(), notes)
      await user.upload(fileInput(), logs)

      expect(filesToSend()).toEqual(['notes.txt (5 B)', 'logs.txt (2 KB)'])
    })

    it('removes only the file whose button was clicked', async () => {
      const user = userEvent.setup()
      renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

      await user.upload(fileInput(), [notes, logs])
      await user.click(removeButton('notes.txt'))

      expect(filesToSend()).toEqual(['logs.txt (2 KB)'])
    })

    it('removes the right one of two files with the same name', async () => {
      const user = userEvent.setup()
      renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

      await user.upload(fileInput(), [new File(['a'], 'same.txt'), new File(['bb'], 'same.txt')])
      await user.click(screen.getAllByRole('button', { name: 'Remove same.txt' })[1]!)

      expect(filesToSend()).toEqual(['same.txt (1 B)'])
    })

    it('hides the list when the last file is removed', async () => {
      const user = userEvent.setup()
      renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

      await user.upload(fileInput(), notes)
      await user.click(removeButton('notes.txt'))

      expect(screen.queryByRole('list', { name: 'Files to send' })).not.toBeInTheDocument()
    })

    it('lets the same file be chosen again after it was removed', async () => {
      const user = userEvent.setup()
      renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

      await user.upload(fileInput(), notes)
      await user.click(removeButton('notes.txt'))
      await user.upload(fileInput(), notes)

      expect(filesToSend()).toEqual(['notes.txt (5 B)'])
    })

    describe('limits', () => {
      it('accepts a file at the per-file limit and a total at the per-reply limit', async () => {
        const user = userEvent.setup()
        renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

        await user.upload(fileInput(), fileOfSize('first.bin', MAX_ATTACHMENT_BYTES))
        await user.upload(
          fileInput(),
          fileOfSize('second.bin', MAX_REPLY_ATTACHMENT_BYTES - MAX_ATTACHMENT_BYTES),
        )

        expect(filesToSend()).toEqual(['first.bin (10.0 MB)', 'second.bin (8.0 MB)'])
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      })

      it('drops a whole choice with a file over the limit and keeps the earlier files', async () => {
        const user = userEvent.setup()
        renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

        await user.upload(fileInput(), notes)
        await user.upload(fileInput(), [logs, fileOfSize('big.bin', MAX_ATTACHMENT_BYTES + 1)])

        expect(screen.getByRole('alert').textContent).toBe('big.bin is over the 10.0 MB limit for a file.')
        expect(filesToSend()).toEqual(['notes.txt (5 B)'])
      })

      it('drops a whole choice that goes over the number of files and keeps the earlier files', async () => {
        const user = userEvent.setup()
        renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)
        const earlier = Array.from(
          { length: MAX_REPLY_ATTACHMENTS - 1 },
          (_, i) => new File(['x'], `file-${i}.txt`),
        )

        await user.upload(fileInput(), earlier)
        await user.upload(fileInput(), [notes, logs])

        expect(screen.getByRole('alert').textContent).toBe('A reply can have at most 10 files.')
        expect(filesToSend()).toEqual(earlier.map((file) => `${file.name} (1 B)`))

        // One more still fits: the limit is 10, and the message goes with the valid choice.
        await user.upload(fileInput(), notes)

        expect(filesToSend()).toHaveLength(MAX_REPLY_ATTACHMENTS)
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      })

      it('drops a choice that goes over the total size and keeps the earlier files', async () => {
        const user = userEvent.setup()
        renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

        await user.upload(fileInput(), fileOfSize('first.bin', MAX_ATTACHMENT_BYTES))
        await user.upload(
          fileInput(),
          fileOfSize('second.bin', MAX_REPLY_ATTACHMENT_BYTES - MAX_ATTACHMENT_BYTES + 1),
        )

        expect(screen.getByRole('alert').textContent).toBe('The files are over the 18.0 MB limit for a reply.')
        expect(filesToSend()).toEqual(['first.bin (10.0 MB)'])
      })

      it('clears the message when a file is removed', async () => {
        const user = userEvent.setup()
        renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

        await user.upload(fileInput(), notes)
        await user.upload(fileInput(), fileOfSize('big.bin', MAX_ATTACHMENT_BYTES + 1))
        expect(screen.getByRole('alert')).toBeInTheDocument()
        await user.click(removeButton('notes.txt'))

        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      })
    })

    it('posts one "attachments" field per file, after the body', async () => {
      const user = userEvent.setup()
      const post = vi.spyOn(axios, 'post').mockResolvedValue({ status: 201, data: { reply } })
      renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

      await user.type(textarea(), `  ${reply.body}  `)
      await user.upload(fileInput(), [notes, logs])
      await user.click(sendButton())

      expect(post).toHaveBeenCalledExactlyOnceWith('/api/tickets/42/replies', expect.any(FormData))
      expect([...sentForm().keys()]).toEqual(['body', 'attachments', 'attachments'])
      expect(sentForm().get('body')).toBe(reply.body)
      const [first, second] = sentForm().getAll('attachments')
      expect(first).toBe(notes)
      expect(second).toBe(logs)
    })

    it('posts only the body when no file is chosen', async () => {
      const user = userEvent.setup()
      vi.spyOn(axios, 'post').mockResolvedValue({ status: 201, data: { reply } })
      renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

      await user.type(textarea(), reply.body)
      await user.click(sendButton())

      expect([...sentForm().entries()]).toEqual([['body', reply.body]])
    })

    it('leaves a removed file out of the request', async () => {
      const user = userEvent.setup()
      vi.spyOn(axios, 'post').mockResolvedValue({ status: 201, data: { reply } })
      renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

      await user.type(textarea(), reply.body)
      await user.upload(fileInput(), [notes, logs])
      await user.click(removeButton('notes.txt'))
      await user.click(sendButton())

      const attachments = sentForm().getAll('attachments')
      expect(attachments).toHaveLength(1)
      expect(attachments[0]).toBe(logs)
    })

    it('clears the files and the limit message once the reply is sent', async () => {
      const user = userEvent.setup()
      vi.spyOn(axios, 'post').mockResolvedValue({ status: 201, data: { reply } })
      renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

      await user.type(textarea(), reply.body)
      await user.upload(fileInput(), notes)
      await user.upload(fileInput(), fileOfSize('big.bin', MAX_ATTACHMENT_BYTES + 1))
      expect(screen.getByRole('alert')).toBeInTheDocument()
      await user.click(sendButton())

      await waitFor(() => expect(textarea()).toHaveValue(''))
      expect(filesToSend()).toEqual([])
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('keeps the files when sending fails, and sends them on the next try', async () => {
      const user = userEvent.setup()
      const post = vi
        .spyOn(axios, 'post')
        .mockRejectedValueOnce(httpError(500))
        .mockResolvedValueOnce({ status: 201, data: { reply } })
      renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

      await user.type(textarea(), reply.body)
      await user.upload(fileInput(), notes)
      await user.click(sendButton())

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toBe("Couldn't send the reply: Request failed (500)")
      expect(filesToSend()).toEqual(['notes.txt (5 B)'])
      expect(removeButton('notes.txt')).toBeEnabled()
      expect(attachButton()).toBeEnabled()

      await user.click(sendButton())

      await waitFor(() => expect(filesToSend()).toEqual([]))
      expect(post).toHaveBeenCalledTimes(2)
      expect(sentForm().get('attachments')).toBe(notes)
    })

    it('disables the attach and remove buttons while the reply is being sent', async () => {
      const user = userEvent.setup()
      vi.spyOn(axios, 'post').mockReturnValue(new Promise(() => {}))
      renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

      await user.type(textarea(), reply.body)
      await user.upload(fileInput(), notes)
      expect(attachButton()).toBeEnabled()
      expect(removeButton('notes.txt')).toBeEnabled()
      await user.click(sendButton())

      await waitFor(() => expect(attachButton()).toBeDisabled())
      expect(removeButton('notes.txt')).toBeDisabled()
      // The files stay until the server has accepted them.
      expect(filesToSend()).toEqual(['notes.txt (5 B)'])
    })

    it('disables the attach and remove buttons while polishing, keeps the files and polishes only the text', async () => {
      const user = userEvent.setup()
      let resolve!: (value: { data: { body: string } }) => void
      const post = vi.spyOn(axios, 'post').mockReturnValue(new Promise((r) => (resolve = r)))
      renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

      await user.type(textarea(), draft)
      await user.upload(fileInput(), notes)
      await user.click(polishButton())

      await waitFor(() => expect(attachButton()).toBeDisabled())
      expect(removeButton('notes.txt')).toBeDisabled()

      resolve({ data: { body: polished } })

      await waitFor(() => expect(attachButton()).toBeEnabled())
      expect(removeButton('notes.txt')).toBeEnabled()
      expect(filesToSend()).toEqual(['notes.txt (5 B)'])
      expect(post).toHaveBeenCalledExactlyOnceWith('/api/tickets/42/replies/polish', { body: draft })
    })

    it('blocks sending a blank reply that has files', async () => {
      const user = userEvent.setup()
      const post = vi.spyOn(axios, 'post')
      renderWithQuery(<ReplyForm ticket={{ id: 42 }} />)

      await user.upload(fileInput(), notes)
      await user.type(textarea(), '   ')

      expect(sendButton()).toBeDisabled()
      await user.keyboard('{Meta>}{Enter}{/Meta}')
      // Blank is blocked before validation runs, so no error shows either.
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(post).not.toHaveBeenCalled()
      expect(filesToSend()).toEqual(['notes.txt (5 B)'])
    })
  })
})
