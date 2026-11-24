import type { ReactNode } from 'react'
import type { VisibleFetchState } from '../fetch/resource.ts'
import { FailureNotice } from '../ui/FailureNotice.tsx'
import { Skeleton } from '../ui/Skeleton.tsx'

type FetchStateViewProps<T> = {
  state: VisibleFetchState<T>
  noun: string
  idleMessage?: string
  skeletonClassName?: string
  children: (data: T) => ReactNode
}

export const ISSUER_NOT_LINKED_MESSAGE =
  "Company data isn't linked to this listing yet. Search for the symbol to load it."

export function FetchStateView<T>({
  state,
  noun,
  idleMessage = ISSUER_NOT_LINKED_MESSAGE,
  skeletonClassName = 'h-16',
  children,
}: FetchStateViewProps<T>) {
  if (state.status === 'idle') return <p className="text-sm text-muted">{idleMessage}</p>
  if (state.status === 'loading') return <Skeleton label={`Loading ${noun}`} className={skeletonClassName} />
  if (state.status === 'unavailable') {
    return <FailureNotice message={`Couldn't load the ${noun}.`} detail={state.reason} onRetry={state.retry} />
  }
  if (state.status === 'not_on_file') return <p className="text-sm text-muted">{`No ${noun} on file.`}</p>
  return (
    <>
      {children(state.data)}
      {state.refreshError !== null && <RefreshFailedNote noun={noun} error={state.refreshError} />}
    </>
  )
}

export function RefreshFailedNote({ noun, error }: { noun: string; error: string }) {
  return (
    <p className="text-xs text-faint" title={error}>
      Showing earlier {noun}. Couldn't refresh.
    </p>
  )
}
