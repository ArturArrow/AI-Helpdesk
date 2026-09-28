import axios from 'axios'

// A short message for a failed API request: the HTTP status when there is one.
export function errorMessage(error: Error) {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined
  return status ? `Request failed (${status})` : 'Request failed'
}
