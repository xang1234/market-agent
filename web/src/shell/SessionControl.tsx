import { useAuth } from './useAuth'

// Compact shell-owned session control intended for the TopBar. Exists so auth
// transitions (sign in, sign out) can be triggered from any surface without
// leaving the shell — that is how we exercise the soft-guard contract (e.g.,
// sign out while on /chat, observe Chat collapse to the gate while Home
// still renders).
//
// Development affordance for P0.1; replaced by the real identity-backed
// profile menu in a later phase.
export function SessionControl() {
  const { session, signIn, signOut } = useAuth()
  if (session) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="truncate text-muted">{session.displayName}</span>
        <button
          type="button"
          onClick={signOut}
          className="rounded-md border border-line-strong px-2 py-1 text-fg-soft transition-colors hover:bg-surface-hover"
        >
          Sign out
        </button>
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={() => signIn()}
      className="rounded-md bg-gradient-to-br from-accent to-accent-strong px-3 py-1.5 text-xs font-medium text-on-accent transition-opacity hover:opacity-90"
    >
      Sign in
    </button>
  )
}
