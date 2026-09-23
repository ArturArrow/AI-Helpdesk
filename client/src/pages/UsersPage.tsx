import UserForm from '@/components/UserForm.tsx'
import UsersTable from '@/components/UsersTable.tsx'

function UsersPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Users</h1>
        <UserForm />
      </div>
      <UsersTable />
    </div>
  )
}

export default UsersPage
