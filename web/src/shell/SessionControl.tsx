import { useAuth } from './useAuth'

// Minimal shell-owned session control. Exists so auth transitions (sign in,
// sign out) can be triggered from any surface without leaving the shell —
// that is how we exercise the soft-guard contract (e.g., sign out while on
// /chat, observe Chat collapse to the gate while Home still renders).
//
// This is a development affordance for P0.1; it will be replaced by the real
// identity-backed profile menu in a later phase.
export function SessionControl() {
  const { session, signIn, signOut } = useAuth()
  return (
    <div className="flex flex-col gap-2 border-t border-neutral-200 px-4 py-3 text-xs">
      {session ? (
        <>
          <span className="text-neutral-700">
            Signed in as <strong>{session.displayName}</strong>
          </span>
          <button
            type="button"
            onClick={signOut}
            className="self-start rounded border border-neutral-300 px-2 py-1 text-neutral-700 transition-colors hover:bg-neutral-100"
          >
            Sign out
          </button>
        </>
      ) : (
        <>
          <span className="text-neutral-500">Not signed in</span>
          <button
            type="button"
            onClick={() => signIn()}
            className="self-start rounded bg-neutral-900 px-2 py-1 text-white transition-colors hover:bg-neutral-700"
          >
            Sign in
          </button>
        </>
      )}
    </div>
  )
}
