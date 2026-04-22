import { useAuth } from './useAuth'
import { useAuthInterrupt } from './useAuthInterrupt'

// The inline auth interrupt modal. Rendered once in the shell, only visible
// when a public-route caller has fired a protected action while unauthed.
// On sign-in (from this modal or from any other surface) the
// AuthInterruptProvider's effect flushes the pending action; on cancel the
// action is discarded without a route change.
export function AuthInterrupt() {
  const { pending, cancel } = useAuthInterrupt()
  const { signIn } = useAuth()

  if (pending == null) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-interrupt-title"
      data-testid="auth-interrupt"
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4"
      // Backdrop click cancels — matches typical modal-dismiss UX. The dialog
      // surface below stops propagation so clicks inside the card don't
      // accidentally dismiss.
      onClick={cancel}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="auth-interrupt-title" className="text-lg font-semibold text-neutral-900">
          {pending.title}
        </h2>
        {pending.description ? (
          <p className="mt-2 text-sm text-neutral-600">{pending.description}</p>
        ) : null}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={cancel}
            className="rounded-md px-3 py-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => signIn()}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700"
          >
            Sign in
          </button>
        </div>
      </div>
    </div>
  )
}
