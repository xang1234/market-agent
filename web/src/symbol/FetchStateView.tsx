import type { ReactNode } from 'react'
import type { VisibleFetchState } from './useFetched.ts'

type FetchStateViewProps<T> = {
  state: VisibleFetchState<T>
  noun: string
  idleMessage: string
  children: (data: T) => ReactNode
}

const PLACEHOLDER_CLASS = 'text-sm text-neutral-500 dark:text-neutral-400'

export function FetchStateView<T>({
  state,
  noun,
  idleMessage,
  children,
}: FetchStateViewProps<T>) {
  if (state.status === 'idle') return <p className={PLACEHOLDER_CLASS}>{idleMessage}</p>
  if (state.status === 'loading') return <p className={PLACEHOLDER_CLASS}>Loading {noun}…</p>
  if (state.status === 'unavailable') {
    return (
      <p className={PLACEHOLDER_CLASS}>
        {capitalize(noun)} unavailable: {state.reason}
      </p>
    )
  }
  return <>{children(state.data)}</>
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1)
}
