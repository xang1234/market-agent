import { useRouteError } from 'react-router-dom'
import { FailureNotice } from '../ui/FailureNotice'

// The shell's frame, painted while the first page's chunk downloads.
export function ShellFrame() {
  return (
    <div className="flex h-full w-full bg-bg">
      <aside className="h-full w-60 shrink-0 border-r border-line bg-surface" />
      <div className="h-14 flex-1 border-b border-line bg-surface/70" />
    </div>
  )
}

export function PageLoadError() {
  const error = useRouteError()
  return (
    <div className="p-6">
      <FailureNotice
        message="Couldn't load this page."
        detail={error instanceof Error ? error.message : String(error)}
        onRetry={() => window.location.reload()}
      />
    </div>
  )
}
