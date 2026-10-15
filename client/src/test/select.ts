import { screen } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'

// Opens a Base UI select and clicks the option with the given name.
export async function choose(user: UserEvent, select: HTMLElement, option: string) {
  await user.click(select)
  await user.click(await screen.findByRole('option', { name: option }))
}
