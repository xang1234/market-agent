import { useAuth } from './useAuth'
import { PRIMARY_BUTTON_CLASS } from './buttonStyles.ts'
import { useAuthInterrupt } from './useAuthInterrupt'

// The inline auth interrupt modal. Rendered once in the shell, only visible
// when a public-route caller has fired a protected action while unauthed.
// On sign-in (from this modal or from any other surface) the
// AuthInterruptProvider's effect flushes the pending action; on cancel the
// action is discarded without a route change.
export function AuthInterrupt() {
  const { pending, cancel } = useAuthInterrupt()
  const { session, signIn } = useAuth()

  if (pending == null || session != null) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-interrupt-title"
      data-testid="auth-interrupt"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      // Backdrop click cancels — matches typical modal-dismiss UX. The dialog
      // surface below stops propagation so clicks inside the card don't
      // accidentally dismiss.
      onClick={cancel}
    >
      <div
        className="w-full max-w-md rounded-lg bg-surface p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="auth-interrupt-title" className="text-lg font-semibold text-fg">
          {pending.title}
        </h2>
        {pending.description ? (
          <p className="mt-2 text-sm text-muted">{pending.description}</p>
        ) : null}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={cancel}
            className="rounded-md px-3 py-2 text-sm text-fg transition-colors hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => signIn()}
            className={PRIMARY_BUTTON_CLASS}
          >
            Sign in
          </button>
        </div>
      </div>
    </div>
  )
}
