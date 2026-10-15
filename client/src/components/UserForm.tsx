import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { AlertCircleIcon, Loader2Icon, PencilIcon, PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { createUserSchema, updateUserSchema, type UpdateUserInput } from 'core/schemas/users'
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
import { Input } from '@/components/ui/input.tsx'
import { Label } from '@/components/ui/label.tsx'
import type { User } from '@/components/UsersTable.tsx'

// With a user, edits that user (a blank password keeps the current one); without, creates an agent.
function UserForm({ user }: { user?: User }) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<UpdateUserInput>({
    resolver: zodResolver(user ? updateUserSchema : createUserSchema),
    defaultValues: formValues(user),
  })

  const saveUser = useMutation({
    mutationFn: (values: UpdateUserInput) =>
      user ? axios.patch(`/api/users/${user.id}`, values) : axios.post('/api/users', values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['users'] })
      setOpen(false)
    },
    onError: (error) => {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined
      const message = axios.isAxiosError(error) ? error.response?.data?.error : undefined
      if (status === 409) {
        setError('email', { message: message ?? 'A user with this email already exists' })
      } else {
        setError('root', { message: message ?? (user ? "Couldn't update user" : "Couldn't create user") })
      }
    },
  })

  function onOpenChange(next: boolean) {
    setOpen(next)
    // Each opening starts from the current user (or an empty form), not the last attempt.
    // Resetting on open rather than close picks up the refetched row after a save.
    if (next) {
      reset(formValues(user))
      saveUser.reset()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {user ? (
        <DialogTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={`Edit ${user.name}`} />}
        >
          <PencilIcon />
        </DialogTrigger>
      ) : (
        <DialogTrigger render={<Button />}>
          <PlusIcon />
          New user
        </DialogTrigger>
      )}

      <DialogContent>
        <form
          onSubmit={handleSubmit((values) => saveUser.mutate(values))}
          noValidate
          className="flex flex-col gap-5"
        >
          <DialogHeader>
            <DialogTitle>{user ? 'Edit user' : 'New user'}</DialogTitle>
            <DialogDescription>
              {user
                ? 'Leave the password blank to keep the current one.'
                : 'Create an agent account.'}
            </DialogDescription>
          </DialogHeader>

          {errors.root && (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertDescription>{errors.root.message}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="name" className={errors.name ? 'text-destructive' : undefined}>
              Name
            </Label>
            <Input
              id="name"
              autoComplete="off"
              aria-invalid={!!errors.name}
              {...register('name')}
            />
            {errors.name && (
              <p role="alert" className="text-sm text-destructive">
                {errors.name.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="email" className={errors.email ? 'text-destructive' : undefined}>
              Email
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="off"
              aria-invalid={!!errors.email}
              {...register('email')}
            />
            {errors.email && (
              <p role="alert" className="text-sm text-destructive">
                {errors.email.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label
              htmlFor="password"
              className={errors.password ? 'text-destructive' : undefined}
            >
              Password
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.password}
              {...register('password')}
            />
            {errors.password && (
              <p role="alert" className="text-sm text-destructive">
                {errors.password.message}
              </p>
            )}
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={saveUser.isPending}>
              {saveUser.isPending && <Loader2Icon className="animate-spin" />}
              {user
                ? saveUser.isPending ? 'Saving…' : 'Save changes'
                : saveUser.isPending ? 'Creating…' : 'Create user'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function formValues(user?: User) {
  return { name: user?.name ?? '', email: user?.email ?? '', password: '' }
}

export default UserForm
