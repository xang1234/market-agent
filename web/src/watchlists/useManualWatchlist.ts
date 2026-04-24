import { useCallback, useEffect, useState } from 'react'
import {
  addManualWatchlistMember,
  listManualWatchlistMembers,
  mergeMemberIntoList,
  removeManualWatchlistMember,
  removeMemberFromList,
  type SubjectRef,
  type WatchlistMember,
} from './membership'

export type ManualWatchlistStatus = 'idle' | 'loading' | 'error'

export type ManualWatchlistState = {
  members: WatchlistMember[]
  status: ManualWatchlistStatus
  message: string | null
  addSubject: (subjectRef: SubjectRef) => Promise<void>
  removeSubject: (subjectRef: SubjectRef) => Promise<void>
}

// Single owner of membership state for the default manual watchlist
// (fra-6al.6.1). WatchlistSlot renders the sidebar chrome + SymbolSearch
// and ManualWatchlist renders the member rows — both call this hook so
// add/remove from either surface stay consistent.
export function useManualWatchlist(userId: string | null): ManualWatchlistState {
  const [members, setMembers] = useState<WatchlistMember[]>([])
  const [status, setStatus] = useState<ManualWatchlistStatus>(() =>
    userId ? 'loading' : 'idle',
  )
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    const controller = new AbortController()
    listManualWatchlistMembers({ userId, signal: controller.signal })
      .then((next) => {
        if (controller.signal.aborted) return
        setMembers(next)
        setStatus('idle')
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setStatus('error')
        setMessage(error instanceof Error ? error.message : 'Failed to load watchlist')
      })
    return () => controller.abort()
  }, [userId])

  const addSubject = useCallback(
    async (subjectRef: SubjectRef) => {
      if (!userId) return
      try {
        const result = await addManualWatchlistMember({ userId, subject_ref: subjectRef })
        setMembers((current) => mergeMemberIntoList(current, result))
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Failed to add')
      }
    },
    [userId],
  )

  const removeSubject = useCallback(
    async (subjectRef: SubjectRef) => {
      if (!userId) return
      let previous: WatchlistMember[] = []
      setMembers((current) => {
        previous = current
        return removeMemberFromList(current, subjectRef)
      })
      try {
        await removeManualWatchlistMember({ userId, subject_ref: subjectRef })
      } catch (error) {
        setMembers(previous)
        setMessage(error instanceof Error ? error.message : 'Failed to remove')
      }
    },
    [userId],
  )

  return { members, status, message, addSubject, removeSubject }
}
