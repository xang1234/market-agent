import { useEffect, useState } from 'react'

// `key` on stored states discriminates "current fetch" from "stale carryover";
// visibleFetchState() collapses mismatched-key results to 'loading'.
type StoredFetchState<T> =
  | { status: 'idle' }
  | { status: 'unavailable'; key: string; reason: string }
  | { status: 'ready'; key: string; data: T }

export type VisibleFetchState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'unavailable'; reason: string }
  | { status: 'ready'; data: T }

export type FetchedResult<T> =
  | { kind: 'ready'; data: T }
  | { kind: 'unavailable'; reason: string }

function visibleFetchState<T>(
  state: StoredFetchState<T>,
  key: string | null,
): VisibleFetchState<T> {
  if (key === null) return { status: 'idle' }
  if (state.status === 'ready' && state.key === key) {
    return { status: 'ready', data: state.data }
  }
  if (state.status === 'unavailable' && state.key === key) {
    return { status: 'unavailable', reason: state.reason }
  }
  return { status: 'loading' }
}

export function useFetched<T>(
  key: string | null,
  doFetch: (key: string, signal: AbortSignal) => Promise<FetchedResult<T>>,
): VisibleFetchState<T> {
  const [stored, setStored] = useState<StoredFetchState<T>>({ status: 'idle' })

  useEffect(() => {
    if (key === null) return
    const controller = new AbortController()
    doFetch(key, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        if (result.kind === 'ready') {
          setStored({ status: 'ready', key, data: result.data })
        } else {
          setStored({ status: 'unavailable', key, reason: result.reason })
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setStored({
          status: 'unavailable',
          key,
          reason: err instanceof Error ? err.message : 'fetch failed',
        })
      })
    return () => controller.abort()
    // key-only deps: doFetch closure is intentionally fresh per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return visibleFetchState(stored, key)
}
