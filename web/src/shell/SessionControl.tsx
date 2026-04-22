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
        <span className="hidden text-neutral-600 sm:inline dark:text-neutral-400">
          {session.displayName}
        </span>
        <button
          type="button"
          onClick={signOut}
          className="rounded border border-neutral-300 px-2 py-1 text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
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
      className="rounded bg-neutral-900 px-3 py-1.5 text-xs text-white transition-colors hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
    >
      Sign in
    </button>
  )
}
