import type { MarketDataAdapter } from "./adapter.ts";
import { isAvailable } from "./availability.ts";
import type { MarketCacheRepository } from "./cache-repository.ts";

const DEFAULT_ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_LIMIT = 200;

export type QuoteRefreshSummary = {
  scanned: number;
  refreshed: number;
  failed: number;
};

export type QuoteRefreshLogEvent = {
  kind: "refresh_failed";
  listing_id: string;
  reason: string;
  detail?: string;
};

export type QuoteRefreshDeps = {
  cache: MarketCacheRepository;
  adapter: MarketDataAdapter;
  clock?: () => Date;
  activeWindowMs?: number;
  limit?: number;
  log?: (event: QuoteRefreshLogEvent) => void;
};

// One sweep: re-fetch the quote for each listing whose latest cache row is stale
// and was fetched within the active window. getQuote on the cached adapter does
// the fetch+store for a stale listing; on provider failure it leaves the old
// quote in place, which we tally as `failed`. Sequential to respect provider
// rate limits; `limit` bounds the work per sweep.
export async function runQuoteRefreshOnce(deps: QuoteRefreshDeps): Promise<QuoteRefreshSummary> {
  const clock = deps.clock ?? (() => new Date());
  const activeWindowMs = deps.activeWindowMs ?? DEFAULT_ACTIVE_WINDOW_MS;
  const limit = deps.limit ?? DEFAULT_LIMIT;
  const log = deps.log ?? defaultLog;

  const now = clock();
  const targets = await deps.cache.listStaleActiveListings({
    now: now.toISOString(),
    activeSince: new Date(now.getTime() - activeWindowMs).toISOString(),
    limit,
  });

  let refreshed = 0;
  let failed = 0;
  for (const listing of targets) {
    const outcome = await deps.adapter.getQuote({ listing });
    if (isAvailable(outcome)) {
      refreshed++;
    } else {
      failed++;
      log({
        kind: "refresh_failed",
        listing_id: listing.id,
        reason: outcome.reason,
        detail: outcome.detail,
      });
    }
  }
  return { scanned: targets.length, refreshed, failed };
}

function defaultLog(event: QuoteRefreshLogEvent): void {
  console.warn(`[market-refresh] ${event.kind}`, event);
}
