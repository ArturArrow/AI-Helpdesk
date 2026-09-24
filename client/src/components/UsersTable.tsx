import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { Role } from 'core/constants/role'
import DeleteUserDialog from '@/components/DeleteUserDialog.tsx'
import UserForm from '@/components/UserForm.tsx'
import { Skeleton } from '@/components/ui/skeleton.tsx'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table.tsx'

export type User = {
  id: string
  name: string
  email: string
  role: Role
  createdAt: string
}

function UsersTable() {
  const { data: users, error } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await axios.get<{ users: User[] }>('/api/users')
      return res.data.users
    },
  })

  return error ? (
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
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
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
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <UserForm user={user} />
                    {user.role !== Role.admin && <DeleteUserDialog user={user} />}
                  </div>
                </TableCell>
              </TableRow>
            ))
          : Array.from({ length: 3 }, (_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                <TableCell><Skeleton className="h-4 w-44" /></TableCell>
                <TableCell><Skeleton className="h-4 w-14" /></TableCell>
                <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                <TableCell><Skeleton className="ml-auto h-7 w-15" /></TableCell>
              </TableRow>
            ))}
      </TableBody>
    </Table>
  )
}

function errorMessage(error: Error) {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined
  return status ? `Request failed (${status})` : 'Request failed'
}

export default UsersTable
