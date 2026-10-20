import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, type To } from 'react-router'

// A muted "← Back to …" link at the top of a page.
function BackLink({ to, children }: { to: To; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      {children}
    </Link>
  )
}

export default BackLink
