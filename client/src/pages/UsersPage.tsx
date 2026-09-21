import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { Skeleton } from '@/components/ui/skeleton.tsx'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table.tsx'

type User = {
  id: string
  name: string
  email: string
  role: 'admin' | 'agent'
  createdAt: string
}

function UsersPage() {
  const { data: users, error } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await axios.get<{ users: User[] }>('/api/users')
      return res.data.users
    },
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Users</h1>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          Couldn't load users: {errorMessage(error)}
        </p>
      ) : users?.length === 0 ? (
        <p className="text-muted-foreground">No users yet.</p>
      ) : (
        <Table aria-busy={!users}>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users
              ? users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.name}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell className="capitalize">{user.role}</TableCell>
                    <TableCell>{new Date(user.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))
              : Array.from({ length: 3 }, (_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-44" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-14" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

function errorMessage(error: Error) {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined
  return status ? `Request failed (${status})` : 'Request failed'
}

export default UsersPage
