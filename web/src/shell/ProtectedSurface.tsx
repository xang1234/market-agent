import type { ReactNode } from 'react'
import { useAuth } from './useAuth'
import { AuthGate } from './AuthGate'

// Soft in-shell guard (spec §3.10). When `session` is null this swaps the
// protected main-canvas content for the in-shell <AuthGate />, but it never
// unmounts the surrounding <WorkspaceShell />. That is what makes session
// loss on /chat collapse Chat content in place while Home keeps rendering.
export function ProtectedSurface({
  destinationLabel,
  children,
}: {
  destinationLabel: string
  children: ReactNode
}) {
  const { session } = useAuth()
  if (session == null) return <AuthGate destinationLabel={destinationLabel} />
  return <>{children}</>
}
