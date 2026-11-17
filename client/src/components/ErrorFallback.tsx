import { AlertCircleIcon, RotateCcwIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert.tsx'
import { Button } from '@/components/ui/button.tsx'

// Shown by the Sentry error boundaries (ProtectedLayout, main.tsx) in place of what failed to
// render. The boundary has already reported the error.
function ErrorFallback({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertCircleIcon />
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>
        <p>This page couldn't be displayed. The error has been reported.</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCcwIcon />
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  )
}

export default ErrorFallback
