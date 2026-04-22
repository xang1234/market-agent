import { createContext } from 'react'

// Auth is modeled as an opaque session envelope, per spec §3.10 — the contract
// is written in terms of authenticated session scope rather than a specific
// identity or entitlement backend. P0.1 deliberately does not commit to an
// identity provider; this mock is swapped out when the real backend lands.
export type AuthSession = {
  userId: string
  displayName: string
}

export type AuthContextValue = {
  session: AuthSession | null
  signIn: (session?: AuthSession) => void
  signOut: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
