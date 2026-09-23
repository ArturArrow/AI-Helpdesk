import { useQuery } from '@tanstack/react-query'
import axios from 'axios'

// Stands in for UsersPage: an active ['users'] query, so invalidation shows up as a refetch.
export function UsersQuery() {
  useQuery({ queryKey: ['users'], queryFn: () => axios.get('/api/users') })
  return null
}
