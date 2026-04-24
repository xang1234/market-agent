import { useContext, useEffect, useEffectEvent } from 'react'
import { AuthInterruptContext, type ProtectedActionOfKind } from './authInterruptTypes'
import type { ProtectedActionKind } from './authInterruptState'

// Consumer hook for the auth-interrupt slot. Most callers want the narrower
// `useRequestProtectedAction` below — this one exposes the full context
// (pending + cancel) and is what the modal itself consumes.
export function useAuthInterrupt() {
  const ctx = useContext(AuthInterruptContext)
  if (!ctx) throw new Error('useAuthInterrupt must be used inside AuthInterruptProvider')
  return ctx
}

// The typical consumer: a button handler that wants "run this if authed,
// otherwise prompt sign-in and resume after."
export function useRequestProtectedAction() {
  return useAuthInterrupt().requestProtectedAction
}

export function useResumedProtectedAction<K extends ProtectedActionKind>(
  actionType: K,
  onResume: (action: ProtectedActionOfKind<K>) => void,
) {
  const { resumedAction, clearResumedAction } = useAuthInterrupt()
  const onResumeEvent = useEffectEvent(onResume)

  useEffect(() => {
    if (resumedAction?.actionType !== actionType) return

    const action = resumedAction as ProtectedActionOfKind<K>
    onResumeEvent(action)
    clearResumedAction(action.resumeToken)
  }, [resumedAction, actionType, clearResumedAction])
}
