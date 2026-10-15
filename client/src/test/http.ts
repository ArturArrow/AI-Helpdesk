import { AxiosError, type AxiosResponse } from 'axios'

// A rejected request as axios produces it: status on the response, optional `{ error }` body.
export function httpError(status: number, data?: { error: string }) {
  return new AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_REQUEST',
    undefined,
    undefined,
    { status, data } as AxiosResponse,
  )
}
