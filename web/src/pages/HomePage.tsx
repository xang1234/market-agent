import { useEffect } from 'react'
import { webDevFlags } from '../devFlags'
import { useRightRail } from '../shell/useRightRail'

// Home is a findings-first surface. This bead (P0.1.1) only needs the
// scaffolded page — actual Home-feed work is P4.4.
export function HomePage() {
  const { setContent } = useRightRail()

  useEffect(() => {
    setContent(
      <div className="border-b border-neutral-200 px-4 py-3 text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        Home rail (P4.5 activity stream)
      </div>,
    )
    return () => setContent(null)
  }, [setContent])

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-auto p-8">
      <header>
        <h1 className="text-2xl font-semibold">Home</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Cross-agent findings, market pulse, watchlist movers. Placeholder for P4.4.
        </p>
      </header>
      {webDevFlags.showDevBanner ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          Dev banner flag is enabled. Placeholder services are expected in the local stack.
        </div>
      ) : null}
      <div className="rounded-md border border-neutral-200 bg-white p-6 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
        Findings feed will render here once P5.3 (findings) and P4.4 (Home) are implemented.
      </div>
    </div>
  )
}
