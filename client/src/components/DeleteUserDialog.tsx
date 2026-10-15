import { useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { AlertCircleIcon, Loader2Icon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert.tsx'
import { Button } from '@/components/ui/button.tsx'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog.tsx'
import type { User } from '@/components/UsersTable.tsx'

function DeleteUserDialog({ user }: { user: User }) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()

  const deleteUser = useMutation({
    mutationFn: () => axios.delete(`/api/users/${user.id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['users'] })
      setOpen(false)
    },
  })

  function onOpenChange(next: boolean) {
    setOpen(next)
    // Each opening starts without the last attempt's error.
    if (next) deleteUser.reset()
  }

  const error = deleteUser.error
  const errorMessage =
    (axios.isAxiosError(error) ? error.response?.data?.error : undefined) ?? "Couldn't delete user"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={`Delete ${user.name}`} />}
      >
        <Trash2Icon />
      </DialogTrigger>

      <DialogContent className="flex flex-col gap-5">
        <DialogHeader>
          <DialogTitle>Delete user</DialogTitle>
          <DialogDescription>
            Delete {user.name} ({user.email})? They will be signed out and won't be able to sign
            in.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            variant="destructive"
            disabled={deleteUser.isPending}
            onClick={() => deleteUser.mutate()}
          >
            {deleteUser.isPending && <Loader2Icon className="animate-spin" />}
            {deleteUser.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default DeleteUserDialog
