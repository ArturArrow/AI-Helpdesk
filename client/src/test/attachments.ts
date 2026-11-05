import { screen, within } from '@testing-library/react'
import type { Attachment } from 'core/constants/attachment'

// An inline image, for HTML that links to it with cid:shot@x.
export const screenshot: Attachment = {
  id: 7,
  filename: 'shot.png',
  contentType: 'image/png',
  size: 2048,
  contentId: 'shot@x',
  tooLarge: false,
}

export const report: Attachment = {
  id: 8,
  filename: 'report.pdf',
  contentType: 'application/pdf',
  size: 512,
  contentId: null,
  tooLarge: false,
}

// The text of each row in the attachment list, e.g. 'report.pdf (512 B)'.
export function listedFiles() {
  const list = screen.getByRole('list', { name: 'Attachments' })
  return within(list).getAllByRole('listitem').map((item) => item.textContent)
}
