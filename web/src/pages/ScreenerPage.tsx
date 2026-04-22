// Screener defaults to a denser main-canvas layout and does NOT opt into the
// right rail. Per spec §3.7: "Screener defaults to a denser main-canvas layout
// and may opt into the rail later without changing the shell contract."
export function ScreenerPage() {
  return (
    <div className="flex flex-1 flex-col gap-6 overflow-auto p-6">
      <header>
        <h1 className="text-2xl font-semibold">Screener</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Build, refine, and view one active screen. Full surface ships with P1.4b.
        </p>
      </header>
      <div className="rounded-md border border-neutral-200 bg-white p-6 text-sm text-neutral-500">
        Query controls + result table — public browsing; saving requires session.
      </div>
    </div>
  )
}
