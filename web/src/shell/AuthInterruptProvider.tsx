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
} from './authInterruptTypes'
import {
  AUTH_INTERRUPT_STORAGE_KEY,
  createPendingProtectedAction,
  getCurrentRoutePath,
  getCurrentRouteSnapshot,
  parsePendingProtectedAction,
  planPendingProtectedActionResume,
  planProtectedActionResumeDispatch,
  serializePendingProtectedAction,
  type PendingProtectedAction,
  type ProtectedAction,
} from './authInterruptState'
import { dispatchProtectedAction } from './protectedActionRegistry'

type QueuedResume = {
  action: ProtectedAction
  path: string
}

function readStoredPendingProtectedAction(): PendingProtectedAction | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.sessionStorage.getItem(AUTH_INTERRUPT_STORAGE_KEY)
    const pending = parsePendingProtectedAction(raw)

    if (raw != null && pending == null) {
      window.sessionStorage.removeItem(AUTH_INTERRUPT_STORAGE_KEY)
    }

    return pending
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
  const queuedResumeKeyRef = useRef<string | null>(null)
  const dispatchedResumeKeyRef = useRef<string | null>(null)
  const [pending, setPendingState] = useState<PendingProtectedAction | null>(
    readStoredPendingProtectedAction,
  )
  const [queuedResume, setQueuedResume] = useState<QueuedResume | null>(null)
  const { pathname, search, hash } = location
  const currentPath = getCurrentRoutePath({ pathname, search, hash })
  const currentRoute = useMemo(
    () => getCurrentRouteSnapshot({ pathname, search, hash }),
    [hash, pathname, search],
  )

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

  const dispatchPlannedResume = useCallback(
    (path: string, action: ProtectedAction) => {
      const plan = planProtectedActionResumeDispatch(
        dispatchedResumeKeyRef.current,
        path,
        action,
      )
      if (!plan.shouldDispatch) return

      dispatchedResumeKeyRef.current = plan.resumeKey
      dispatchProtectedAction(action)

      queueMicrotask(() => {
        if (dispatchedResumeKeyRef.current === plan.resumeKey) {
          dispatchedResumeKeyRef.current = null
        }
      })
    },
    [],
  )

  useEffect(() => {
    const plan = planPendingProtectedActionResume({
      currentPath,
      hasSession: session != null,
      pending,
    })

    if (plan.type === 'idle') return

    if (plan.type === 'expired') {
      queueMicrotask(() => setPending(null))
      return
    }

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
        dispatchProtectedAction(plan.action)
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
  }, [currentPath, navigate, pending, session, setPending])

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
        dispatchProtectedAction(req.action)
        return
      }

      setPending(
        createPendingProtectedAction({
          ...req,
          returnTo: currentRoute,
        }),
      )
    },
    [currentRoute, session, setPending],
  )

  const cancel = useCallback(() => setPending(null), [setPending])

  const value = useMemo<AuthInterruptContextValue>(
    () => ({
      requestProtectedAction,
      pending,
      cancel,
    }),
    [requestProtectedAction, pending, cancel],
  )

  return (
    <AuthInterruptContext.Provider value={value}>
      {children}
    </AuthInterruptContext.Provider>
  )
}
