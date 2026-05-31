import { useLocation } from 'react-router-dom'
import { PRIMARY_BUTTON_CLASS } from './buttonStyles.ts'
import { useAuth } from './useAuth'

// Rendered in the main canvas when a protected surface is entered without a
// session. Per spec §3.10 / bead fra-6al.1.2: this must NOT redirect — the
// shell chrome stays mounted and only the protected main-canvas content
// collapses to this gate. Session loss on a protected route also lands here.
//
// `destinationLabel` is the human-readable surface name ("Chat", "Agents"); it
// exists so the gate can describe the return-to context without leaking the
// raw path. The current pathname is also captured implicitly via useLocation
// so a future sign-in flow can resume the same route on success.
export function AuthGate({ destinationLabel }: { destinationLabel: string }) {
  const { signIn } = useAuth()
  const location = useLocation()

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div
        role="region"
        aria-label={`${destinationLabel} requires sign-in`}
        data-testid="auth-gate"
        className="w-full max-w-md rounded-md border border-line bg-surface p-6 shadow-sm"
      >
        <h2 className="text-lg font-semibold text-fg">
          Sign in to continue to {destinationLabel}
        </h2>
        <p className="mt-2 text-sm text-muted">
          {destinationLabel} is session-scoped. Public surfaces like Home, Screener,
          and Analyze entry remain available without a session.
        </p>
        <button
          type="button"
          onClick={() => signIn()}
          className={`mt-5 inline-flex items-center ${PRIMARY_BUTTON_CLASS}`}
        >
          Sign in
        </button>
        <p className="mt-3 text-xs text-muted">
          After sign-in you will return to <code>{location.pathname}</code>.
        </p>
      </div>
    </div>
  )
}
