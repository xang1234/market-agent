import { useEffect, useState } from 'react'
import { useRightRail } from '../shell/useRightRail'
import {
  useRequestProtectedAction,
  useResumedProtectedAction,
} from '../shell/useAuthInterrupt'

// Home is a findings-first surface. This bead (P0.1.1) only needs the
// scaffolded page — actual Home-feed work is P4.4.
//
// The "Save AAPL to watchlist" button is a P0.1.3 scaffold to exercise the
// inline auth interrupt contract from a public route. It will be replaced
// by the real watchlist CTA in P0.4b (manual watchlist baseline).
export function HomePage() {
  const { setContent } = useRightRail()
  const requestProtectedAction = useRequestProtectedAction()
  const [savedSymbol, setSavedSymbol] = useState<string | null>(null)

  useEffect(() => {
    setContent(
      <div className="border-b border-neutral-200 px-4 py-3 text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        Home rail (P4.5 activity stream)
      </div>,
    )
    return () => setContent(null)
  }, [setContent])

  useResumedProtectedAction('save-to-watchlist', (action) => {
    setSavedSymbol(action.symbol)
  })

  const handleSave = () => {
    requestProtectedAction({
      title: 'Sign in to save to watchlist',
      description: 'Watchlists are session-scoped. Signing in will add AAPL and keep you on Home.',
      action: {
        kind: 'save-to-watchlist',
        symbol: 'AAPL',
      },
    })
  }

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-auto p-8">
      <header>
        <h1 className="text-2xl font-semibold">Home</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Cross-agent findings, market pulse, watchlist movers. Placeholder for P4.4.
        </p>
      </header>
      <div className="rounded-md border border-neutral-200 bg-white p-6 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
        Findings feed will render here once P5.3 (findings) and P4.4 (Home) are implemented.
      </div>
      <div className="rounded-md border border-dashed border-neutral-300 bg-white p-6 dark:border-neutral-700 dark:bg-neutral-900">
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          P0.1.3 scaffold — exercises the inline auth interrupt from a public route.
        </p>
        <button
          type="button"
          data-testid="save-to-watchlist"
          onClick={handleSave}
          className="mt-3 inline-flex items-center rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          Save AAPL to watchlist
        </button>
        {savedSymbol ? (
          <p
            data-testid="save-result"
            className="mt-3 text-sm text-emerald-700 dark:text-emerald-400"
          >
            Saved {savedSymbol} to watchlist.
          </p>
        ) : null}
      </div>
    </div>
  )
}
