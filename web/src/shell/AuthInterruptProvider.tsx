import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './useAuth'
import {
  AuthInterruptContext,
  type AuthInterruptContextValue,
  type ProtectedActionRequest,
  type ResumedProtectedAction,
} from './authInterruptTypes'
import {
  AUTH_INTERRUPT_STORAGE_KEY,
  getCurrentRoutePath,
  parsePendingProtectedAction,
  planPendingProtectedActionResume,
  planProtectedActionResumeDispatch,
  serializePendingProtectedAction,
  type PendingProtectedAction,
  type ProtectedAction,
} from './authInterruptState'

type QueuedResume = {
  action: ProtectedAction
  path: string
}

function readStoredPendingProtectedAction(): PendingProtectedAction | null {
  if (typeof window === 'undefined') return null

  try {
    return parsePendingProtectedAction(window.sessionStorage.getItem(AUTH_INTERRUPT_STORAGE_KEY))
  } catch {
    return null
  }
}

// Owns the pending protected-action slot. Lives inside AuthProvider so it can
// react to session transitions. The flush is wired to the session transition
// itself (via useEffect watching `session`), not to the modal's Sign-in
// button. Pending actions are kept as serializable data plus return-to
// context so a real auth redirect can restore them later without relying on
// in-memory closures.
export function AuthInterruptProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const resumeTokenRef = useRef(0)
  const queuedResumeKeyRef = useRef<string | null>(null)
  const dispatchedResumeKeyRef = useRef<string | null>(null)
  const [pending, setPendingState] = useState<PendingProtectedAction | null>(
    readStoredPendingProtectedAction,
  )
  const [queuedResume, setQueuedResume] = useState<QueuedResume | null>(null)
  const [resumedAction, setResumedAction] = useState<ResumedProtectedAction | null>(null)
  const currentPath = getCurrentRoutePath(location)

  const setPending = useCallback((next: PendingProtectedAction | null) => {
    setPendingState(next)

    if (typeof window === 'undefined') return

    try {
      if (next == null) {
        window.sessionStorage.removeItem(AUTH_INTERRUPT_STORAGE_KEY)
        return
      }

      window.sessionStorage.setItem(
        AUTH_INTERRUPT_STORAGE_KEY,
        serializePendingProtectedAction(next),
      )
    } catch {
      // ignore — sessionStorage may be unavailable.
    }
  }, [])

  const dispatchResumedAction = useCallback((action: ProtectedAction) => {
    resumeTokenRef.current += 1
    setResumedAction({
      ...action,
      resumeToken: resumeTokenRef.current,
    })
  }, [])

  const dispatchPlannedResume = useCallback(
    (path: string, action: ProtectedAction) => {
      const plan = planProtectedActionResumeDispatch(
        dispatchedResumeKeyRef.current,
        path,
        action,
      )
      if (!plan.shouldDispatch) return

      dispatchedResumeKeyRef.current = plan.resumeKey
      dispatchResumedAction(action)

      queueMicrotask(() => {
        if (dispatchedResumeKeyRef.current === plan.resumeKey) {
          dispatchedResumeKeyRef.current = null
        }
      })
    },
    [dispatchResumedAction],
  )

  useEffect(() => {
    const plan = planPendingProtectedActionResume({
      currentPath,
      hasSession: session != null,
      pending,
    })

    if (plan.type === 'idle') return

    if (plan.type === 'dispatch') {
      const dispatchPlan = planProtectedActionResumeDispatch(
        dispatchedResumeKeyRef.current,
        currentPath,
        plan.action,
      )
      if (!dispatchPlan.shouldDispatch) return

      dispatchedResumeKeyRef.current = dispatchPlan.resumeKey
      queueMicrotask(() => {
        setPending(null)
        dispatchResumedAction(plan.action)
        queueMicrotask(() => {
          if (dispatchedResumeKeyRef.current === dispatchPlan.resumeKey) {
            dispatchedResumeKeyRef.current = null
          }
        })
      })
      return
    }

    const queuedPlan = planProtectedActionResumeDispatch(
      queuedResumeKeyRef.current,
      plan.to,
      plan.action,
    )
    if (!queuedPlan.shouldDispatch) return

    queuedResumeKeyRef.current = queuedPlan.resumeKey

    queueMicrotask(() => {
      setPending(null)
      setQueuedResume({
        action: plan.action,
        path: plan.to,
      })
    })
    navigate(plan.to, { replace: true })
  }, [currentPath, dispatchResumedAction, navigate, pending, session, setPending])

  useEffect(() => {
    if (queuedResume == null || currentPath !== queuedResume.path) return

    dispatchPlannedResume(queuedResume.path, queuedResume.action)
    queueMicrotask(() => {
      queuedResumeKeyRef.current = null
      setQueuedResume(null)
    })
  }, [currentPath, dispatchPlannedResume, queuedResume])

  const requestProtectedAction = useCallback(
    (req: ProtectedActionRequest) => {
      if (session != null) {
        dispatchResumedAction(req.action)
        return
      }

      setPending({
        ...req,
        returnTo: currentPath,
      })
    },
    [currentPath, dispatchResumedAction, session, setPending],
  )

  const cancel = useCallback(() => setPending(null), [setPending])

  const clearResumedAction = useCallback((resumeToken: number) => {
    setResumedAction((current) =>
      current?.resumeToken === resumeToken ? null : current,
    )
  }, [])

  const value = useMemo<AuthInterruptContextValue>(
    () => ({
      requestProtectedAction,
      pending,
      cancel,
      resumedAction,
      clearResumedAction,
    }),
    [requestProtectedAction, pending, cancel, resumedAction, clearResumedAction],
  )

  return (
    <AuthInterruptContext.Provider value={value}>
      {children}
    </AuthInterruptContext.Provider>
  )
}
