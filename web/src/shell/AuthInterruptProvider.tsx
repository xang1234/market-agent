import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from './useAuth'
import {
  AuthInterruptContext,
  type AuthInterruptContextValue,
  type ProtectedActionRequest,
} from './authInterruptTypes'

// Owns the pending protected-action slot. Lives inside AuthProvider so it can
// react to session transitions. The flush is wired to the session transition
// itself (via useEffect watching `session`), not to the modal's Sign-in
// button — meaning any future programmatic session restore (e.g., OAuth
// redirect round-trip, multi-tab broadcast) will also flush a pending
// action, without UI coupling (spec §3.10: inline auth interrupts preserve
// the pending-action payload so sign-in resumes the action instead of
// forcing a route change).
export function AuthInterruptProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [pending, setPending] = useState<ProtectedActionRequest | null>(null)

  // Snapshot of session on previous render, used to detect the null → truthy
  // transition without re-firing on every authed re-render.
  const prevSessionRef = useRef(session)

  useEffect(() => {
    const prev = prevSessionRef.current
    prevSessionRef.current = session
    if (prev == null && session != null && pending != null) {
      const toRun = pending.action
      setPending(null)
      toRun()
    }
  }, [session, pending])

  const requestProtectedAction = useCallback(
    (req: ProtectedActionRequest) => {
      if (session != null) {
        req.action()
        return
      }
      setPending(req)
    },
    [session],
  )

  const cancel = useCallback(() => setPending(null), [])

  const value = useMemo<AuthInterruptContextValue>(
    () => ({ requestProtectedAction, pending, cancel }),
    [requestProtectedAction, pending, cancel],
  )

  return (
    <AuthInterruptContext.Provider value={value}>
      {children}
    </AuthInterruptContext.Provider>
  )
}
