// Persistent left-rail watchlist slot (spec §3.7, IA refactor fra-4pz).
// Content is a placeholder here; P0.4b (fra-6al.6 Manual watchlist
// management baseline) fills in the add/remove controls, row rendering,
// sparklines, and the timeframe strip (1D/5D/1M/3M/YTD/1Y/5Y) that scopes
// the sparklines.
//
// Header/dropdown/"+" button/timeframe strip are stubbed at render-time so
// the chrome's shape is visible now; their behavior comes with P0.4b.
const TIMEFRAMES = ['1D', '5D', '1M', '3M', 'YTD', '1Y', '5Y'] as const

export function WatchlistSlot() {
  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-3 dark:border-neutral-800">
        <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Watchlist
          <span className="text-neutral-400 dark:text-neutral-500" aria-hidden="true">
            ▾
          </span>
        </div>
        <button
          type="button"
          disabled
          aria-label="Add to watchlist (ships with P0.4b)"
          className="rounded px-1.5 text-sm text-neutral-400 disabled:cursor-not-allowed dark:text-neutral-500"
        >
          +
        </button>
      </div>
      <div className="flex items-center gap-0.5 border-b border-neutral-200 px-2 py-1.5 dark:border-neutral-800">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            type="button"
            disabled
            className="flex-1 rounded px-1 py-0.5 text-[10px] font-medium text-neutral-500 disabled:cursor-not-allowed dark:text-neutral-400"
          >
            {tf}
          </button>
        ))}
      </div>
      <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-neutral-500 dark:text-neutral-400">
        Watchlist rows ship with P0.4b (manual watchlist baseline).
      </div>
    </aside>
  )
}
