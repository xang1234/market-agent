import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { AuthContext, type AuthContextValue, type AuthSession } from './authTypes'

// Stable dev UUID so mock-backed surfaces that persist by user_id (e.g.
// watchlists, fra-6al.6.1) can round-trip the same canonical id every run.
// Real auth replaces this with a backend-issued UUID.
const DEFAULT_MOCK_SESSION: AuthSession = {
  userId: '00000000-0000-4000-8000-000000000001',
  displayName: 'Mock User',
}

// Mock in-memory auth provider. P0.1.2 deliberately does not commit to a real
// identity backend (bead fra-6al.1.2); the real provider is wired in later
// without changing the ProtectedSurface / AuthGate contract.
export function AuthProvider({
  children,
  initialSession = null,
}: {
  children: ReactNode
  initialSession?: AuthSession | null
}) {
  const [session, setSession] = useState<AuthSession | null>(initialSession)

  const signIn = useCallback((next?: AuthSession) => {
    setSession(next ?? DEFAULT_MOCK_SESSION)
  }, [])

  const signOut = useCallback(() => {
    setSession(null)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ session, signIn, signOut }),
    [session, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
