# Triggered Quote Refresh Design (fra-gaid)

**Status:** Approved (design phase)
**Bead:** fra-gaid — "Quote cache has no background refresh (cold tickers carry very old quotes)"
**Date:** 2026-06-03

## Problem

`market_quote_snapshots` is populated only write-through on read (`CachedMarketDataAdapter.getQuote` stores a quote only when a user request misses a fresh cache entry). Tickers that nobody has requested recently keep whatever quote they last had, expired, indefinitely. The chat path reads the latest cached quote regardless of age (it now flags staleness, per fra-eixm, but cannot refresh it). So a recently-active-but-now-idle ticker is served a stale price with no mechanism to freshen it.

## Goal

Keep quotes for **recently-referenced** subjects reasonably fresh without a user request, by sweeping stale-but-recently-active cache rows on an external cadence and re-fetching them through the existing provider stack.

## Decisions (locked)

1. **Trigger = run-once worker.** `runQuoteRefreshOnce(deps)` does one sweep and returns a summary, mirroring the only existing job pattern in the repo (`services/notifications/src/worker.ts` → `runNotificationWorkerOnce`). The cadence lives in whatever invokes the worker (dev-shell/cron), not in code. No in-process scheduler, no daemon.
2. **Target set = stale + recently-active in cache.** Refresh cached listings where `expires_at < now AND fetched_at > now - activeWindow`. The cache's own `fetched_at` is the "actively-referenced" signal — zero coupling to watchlists / chat threads / home, and it naturally stops refreshing long-abandoned tickers.

Rejected alternatives: in-process interval loop (introduces a long-running-timer concept the codebase lacks, harder to test); on-read lazy refresh (scatters refresh logic into read paths, only helps tickers still being read); explicit watchlist/thread/pulse union (couples the market job to three other services' schemas); all-stale-no-recency (unbounded provider calls for tickers nobody looks at).

## Architecture

One new module + one thin entry, plus one query added to the existing cache repository.

```text
services/market/src/
  quote-refresh.ts          (NEW) runQuoteRefreshOnce(deps): pure, dependency-injected, testable
  cache-repository.ts       (+)   listStaleActiveListings(db, { now, activeSince, limit })
  refresh-worker.ts         (NEW) thin composition entry: builds real pool + adapter, runs once, logs, exits
  package.json              (+)   "refresh": node --experimental-strip-types src/refresh-worker.ts
```

### Unit 1 — `listStaleActiveListings({ now, activeSince, limit })`

A new method on `MarketCacheRepository` (db is captured by the repository, as with `findLatestQuote`). Returns `ReadonlyArray<ListingSubjectRef>` (the `{ kind: "listing", id }` shape `adapter.getQuote` expects). The predicate is **"the listing's most-recent row is expired and was fetched recently"** — we dedup to each listing's latest row *first*, then filter, so a listing that already has a fresh latest quote is never targeted even if it also has older expired rows:

```sql
select listing_id
  from (
    select distinct on (listing_id) listing_id, expires_at, fetched_at
      from market_quote_snapshots
     order by listing_id, fetched_at desc, as_of desc
  ) latest
 where latest.expires_at < $1::timestamptz   -- latest row is stale
   and latest.fetched_at > $2::timestamptz   -- and was fetched recently (active)
 order by latest.fetched_at desc
 limit $3
```

- Lives in `cache-repository.ts` because it reads the cache table the repository already owns.
- Added to the `MarketCacheRepository` interface and both implementations (postgres + in-memory) so the orchestrator can be unit-tested against the in-memory repo. The in-memory impl mirrors the SQL: per listing, take the row with the greatest `fetched_at`, include the listing only if that row is stale and active.

### Unit 2 — `runQuoteRefreshOnce(deps)`

Orchestration only. Signature:

```ts
type QuoteRefreshDeps = {
  cache: MarketCacheRepository;          // for listStaleActiveListings
  adapter: MarketDataAdapter;            // the cached adapter; getQuote fetches+stores when stale
  clock?: () => Date;                    // default () => new Date()
  activeWindowMs?: number;               // default 7 days
  limit?: number;                        // default 200
  log?: (event: QuoteRefreshLogEvent) => void;  // default console.warn-style
};

type QuoteRefreshSummary = { scanned: number; refreshed: number; failed: number };

async function runQuoteRefreshOnce(deps: QuoteRefreshDeps): Promise<QuoteRefreshSummary>;
```

Flow:

```text
now = clock(); activeSince = new Date(now - activeWindowMs)
targets = cache.listStaleActiveListings({ now, activeSince, limit })
for each listing in targets (sequential — respects provider rate limits):
    outcome = await adapter.getQuote({ listing })
    isAvailable(outcome) ? refreshed++ : (failed++, log the unavailable reason)
return { scanned: targets.length, refreshed, failed }
```

Reuses the existing `adapter.getQuote()` primitive: for a stale row, `CachedMarketDataAdapter` already fetches through the provider fallback stack (Polygon → Yahoo dev → Stooq) and `storeQuote`s the result. **No new fetch/store logic is introduced.** On provider failure the adapter leaves the old quote in place (correct — we keep the last good price) and the listing is tallied as `failed`.

Sequential, not concurrent: provider rate limits (Polygon) make serial calls safer, and `limit` bounds the work per sweep. Bounded concurrency is explicitly deferred.

### Unit 3 — `refresh-worker.ts`

Thin composition root. Builds the real `Pool`, the provider stack, and the cached adapter using the **same construction as `services/market/src/dev.ts`** (reuse the existing builder; do not duplicate provider wiring), reads config from env, calls `runQuoteRefreshOnce` once, logs the summary, and exits. Mirrors `notifications/src/worker.ts`.

## Configuration (env, with defaults)

- `QUOTE_REFRESH_ACTIVE_WINDOW_MS` — recency bound for "actively referenced". Default `604800000` (7 days).
- `QUOTE_REFRESH_LIMIT` — max listings per sweep. Default `200`.

Cadence is set by the external invoker (dev-shell/cron), not configured in code.

## Error handling

- **Per-listing provider failure** → logged with the unavailable reason, counted in `failed`, loop continues. One bad ticker never aborts the sweep.
- **DB / query failure** → propagates; the worker exits non-zero and the external scheduler retries on the next cadence. Each `getQuote`/`storeQuote` is atomic, so there is no partial-state risk.
- The worker never throws on individual refresh failures; it only throws on infrastructure failure (DB unreachable).

## Testing

- **Unit** (`services/market/test/quote-refresh.test.ts`, in-memory, fake clock + fake adapter):
  - Seeds the in-memory cache with stale-active, stale-old, and fresh rows; asserts only stale-active listings are targeted and that `limit` caps the set.
  - Fake adapter returning `available` → asserts `refreshed` increments and a new quote is stored.
  - Fake adapter returning `unavailable` → asserts `failed` increments, the old quote is left untouched, and the failure is logged.
  - Empty target set → summary `{ scanned: 0, refreshed: 0, failed: 0 }`, adapter never called.
- **Repository** (`services/market/test/cache-repository.test.ts`, extends the existing file — market convention is in-memory + fake-executor, no real pg):
  - *In-memory impl (semantics):* seed via `storeQuote` with varied `fetched_at`/`expires_at`; assert `listStaleActiveListings` returns only listings whose **latest** row is stale-and-recently-active (a listing with a fresh latest row is excluded even if it has older expired rows), ordered by `fetched_at desc`, respecting `limit`.
  - *Postgres impl (contract):* a fake `MarketCacheQueryExecutor` returning canned `{ listing_id }` rows; assert the method passes `[now, activeSince, limit]` and maps rows to `{ kind: "listing", id }`. (The SQL is trusted as the rest of the postgres impl is — `findFreshQuote` is covered the same way.)

## Out of scope (YAGNI)

- In-process scheduler / interval loop (cadence is external).
- Bounded concurrency (sequential is rate-limit-safe; revisit only if sweeps grow large).
- Watchlist / chat-thread / pulse coupling (the cache's `fetched_at` is a sufficient recency signal).
- Refreshing fundamentals/facts (separate concern; tracked under fra-x3ii).
- Per-listing priority tiers.

## Acceptance

A run-once worker, invoked on an external cadence, re-fetches quotes for listings that are stale (`expires_at < now`) and recently active (`fetched_at` within the window), through the existing provider stack, bounded by a per-sweep limit — keeping recently-referenced quotes reasonably fresh with no user request. Covered by unit + integration tests.
