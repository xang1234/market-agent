import { createContext } from 'react'

// Auth is modeled as an opaque session envelope, per spec §3.10 — the contract
// is written in terms of authenticated session scope rather than a specific
// identity or entitlement backend. P0.1 deliberately does not commit to an
// identity provider; this mock is swapped out when the real backend lands.
export type AuthSession = {
  userId: string
  displayName: string
}

// Stable dev UUID so mock-backed surfaces that persist by user_id (e.g.
// watchlists, fra-6al.6.1) can round-trip the same canonical id every run.
// Real auth replaces this with a backend-issued UUID.
export const DEFAULT_MOCK_SESSION: AuthSession = {
  userId: '00000000-0000-4000-8000-000000000001',
  displayName: 'Mock User',
}

export type AuthContextValue = {
  session: AuthSession | null
  signIn: (session?: AuthSession) => void
  signOut: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
