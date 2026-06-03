# Triggered Quote Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A run-once worker that re-fetches quotes for cache rows that are stale and recently-active, keeping recently-referenced quotes fresh with no user request.

**Architecture:** Add one repository query (`listStaleActiveListings`) that finds listings whose latest cached quote is expired but was fetched within a recency window. A pure orchestrator (`runQuoteRefreshOnce`) iterates those listings and calls the existing cached adapter's `getQuote` (which fetches+stores when stale). A thin worker entry (`refresh-worker.ts`) builds the real provider stack via an extracted `createMarketStackFromEnv` builder and runs one sweep. Cadence is external (dev-shell/cron).

**Tech Stack:** Node `--experimental-strip-types` (no build step), `node:test`, pg, the existing market provider stack (Polygon → Yahoo dev → Stooq) and `CachedMarketDataAdapter`.

**Spec:** `docs/superpowers/specs/2026-06-03-quote-refresh-design.md`. **Bead:** fra-gaid.

**Conventions to follow:**
- Tests run with `cd services/market && npm test` (= `node --experimental-strip-types --test "test/**/*.test.ts"`). Run a single file with `node --experimental-strip-types --test test/<file>.test.ts`.
- The market service tests the cache repository via the **in-memory** impl and via **fake `MarketCacheQueryExecutor`** for the postgres impl. There are NO real-pg integration tests in this service — do not add one.
- Commit trailer (every commit): `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- Modify `services/market/src/cache-repository.ts` — add `listStaleActiveListings` to the `MarketCacheRepository` type and both implementations.
- Create `services/market/src/quote-refresh.ts` — `runQuoteRefreshOnce(deps)` orchestrator (pure, DI'd).
- Create `services/market/src/stack.ts` — `createMarketStackFromEnv(env)` builder, extracted from `dev.ts`.
- Modify `services/market/src/dev.ts` — use the builder; keep only server start + signal handling.
- Create `services/market/src/refresh-worker.ts` — worker entry mirroring `services/notifications/src/worker.ts`.
- Modify `services/market/package.json` — add `"refresh"` script.
- Modify `services/market/test/cache-repository.test.ts` — add in-memory semantics tests + postgres contract test.
- Create `services/market/test/quote-refresh.test.ts` — orchestrator unit tests.
- Create `services/market/test/stack.test.ts` — builder unit tests.

---

### Task 1: `listStaleActiveListings` — interface + in-memory impl

**Files:**
- Modify: `services/market/src/cache-repository.ts`
- Test: `services/market/test/cache-repository.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `services/market/test/cache-repository.test.ts`:

```ts
const STALE_ACTIVE = "11111111-1111-4111-a111-111111111111";
const FRESH_LATEST = "22222222-2222-4222-a222-222222222222";
const STALE_INACTIVE = "33333333-3333-4333-a333-333333333333";

// now = 2026-06-03T00:00Z, activeSince = 2026-05-27T00:00Z (7-day window)
const NOW_ISO = "2026-06-03T00:00:00.000Z";
const ACTIVE_SINCE_ISO = "2026-05-27T00:00:00.000Z";

async function storeQuoteRow(
  repo: ReturnType<typeof createInMemoryMarketCacheRepository>,
  id: string,
  opts: { as_of: string; fetched_at: string; expires_at: string },
): Promise<void> {
  await repo.storeQuote(
    normalizedQuote({
      listing: { kind: "listing", id },
      price: 10,
      prev_close: 9,
      session_state: "regular",
      as_of: opts.as_of,
      delay_class: "delayed_15m",
      currency: "USD",
      source_id: SOURCE_ID,
    }),
    { provider: "polygon_market", fetched_at: opts.fetched_at, expires_at: opts.expires_at },
  );
}

test("listStaleActiveListings returns listings whose latest row is stale and recently active", async () => {
  const repo = createInMemoryMarketCacheRepository();
  // STALE_ACTIVE: latest row expired, fetched within window → included.
  await storeQuoteRow(repo, STALE_ACTIVE, {
    as_of: "2026-06-02T00:00:00.000Z",
    fetched_at: "2026-06-02T12:00:00.000Z",
    expires_at: "2026-06-02T12:30:00.000Z",
  });
  // FRESH_LATEST: an old expired row AND a newer fresh row → latest is fresh → excluded.
  await storeQuoteRow(repo, FRESH_LATEST, {
    as_of: "2026-06-01T00:00:00.000Z",
    fetched_at: "2026-06-01T12:00:00.000Z",
    expires_at: "2026-06-01T12:30:00.000Z",
  });
  await storeQuoteRow(repo, FRESH_LATEST, {
    as_of: "2026-06-02T23:00:00.000Z",
    fetched_at: "2026-06-02T23:00:00.000Z",
    expires_at: "2026-06-03T05:00:00.000Z",
  });
  // STALE_INACTIVE: expired and fetched before the window → excluded.
  await storeQuoteRow(repo, STALE_INACTIVE, {
    as_of: "2026-05-20T00:00:00.000Z",
    fetched_at: "2026-05-20T12:00:00.000Z",
    expires_at: "2026-05-20T12:30:00.000Z",
  });

  const result = await repo.listStaleActiveListings({
    now: NOW_ISO,
    activeSince: ACTIVE_SINCE_ISO,
    limit: 200,
  });

  assert.deepEqual(result, [{ kind: "listing", id: STALE_ACTIVE }]);
});

test("listStaleActiveListings orders by fetched_at desc and respects limit", async () => {
  const repo = createInMemoryMarketCacheRepository();
  const OLDER = "44444444-4444-4444-a444-444444444444";
  const NEWER = "55555555-5555-4555-a555-555555555555";
  await storeQuoteRow(repo, OLDER, {
    as_of: "2026-06-01T00:00:00.000Z",
    fetched_at: "2026-06-01T00:00:00.000Z",
    expires_at: "2026-06-01T00:30:00.000Z",
  });
  await storeQuoteRow(repo, NEWER, {
    as_of: "2026-06-02T00:00:00.000Z",
    fetched_at: "2026-06-02T00:00:00.000Z",
    expires_at: "2026-06-02T00:30:00.000Z",
  });

  const result = await repo.listStaleActiveListings({
    now: NOW_ISO,
    activeSince: ACTIVE_SINCE_ISO,
    limit: 1,
  });

  // NEWER has the greater fetched_at, so it wins the single slot.
  assert.deepEqual(result, [{ kind: "listing", id: NEWER }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/market && node --experimental-strip-types --test test/cache-repository.test.ts`
Expected: FAIL — `repo.listStaleActiveListings is not a function`.

- [ ] **Step 3: Add the method to the interface**

In `services/market/src/cache-repository.ts`, add to the `MarketCacheRepository` type (after `storeBars`):

```ts
  listStaleActiveListings(input: {
    now: string;
    activeSince: string;
    limit: number;
  }): Promise<ReadonlyArray<ListingSubjectRef>>;
```

- [ ] **Step 4: Implement it in the in-memory repository**

In `createInMemoryMarketCacheRepository`, add this method to the returned object (after `storeBars`):

```ts
    async listStaleActiveListings({ now, activeSince, limit }) {
      const nowMs = Date.parse(now);
      const activeSinceMs = Date.parse(activeSince);
      const matches: { id: string; fetchedMs: number }[] = [];
      for (const entries of quotes.values()) {
        if (entries.length === 0) continue;
        // Per-listing latest row by fetched_at (mirrors the SQL distinct-on).
        const latest = entries.reduce((a, b) =>
          Date.parse(b.fetched_at) > Date.parse(a.fetched_at) ? b : a,
        );
        const expiresMs = Date.parse(latest.expires_at);
        const fetchedMs = Date.parse(latest.fetched_at);
        if (expiresMs < nowMs && fetchedMs > activeSinceMs) {
          matches.push({ id: latest.quote.listing.id, fetchedMs });
        }
      }
      matches.sort((a, b) => b.fetchedMs - a.fetchedMs);
      return matches
        .slice(0, limit)
        .map((m) => Object.freeze({ kind: "listing" as const, id: m.id }));
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd services/market && node --experimental-strip-types --test test/cache-repository.test.ts`
Expected: PASS (existing tests + 2 new tests).

- [ ] **Step 6: Commit**

```bash
git add services/market/src/cache-repository.ts services/market/test/cache-repository.test.ts
git commit -m "feat(market): listStaleActiveListings on the cache repository (in-memory)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `listStaleActiveListings` — postgres impl + contract test

**Files:**
- Modify: `services/market/src/cache-repository.ts` (`createPostgresMarketCacheRepository`)
- Test: `services/market/test/cache-repository.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `services/market/test/cache-repository.test.ts`. This uses a fake `MarketCacheQueryExecutor` (the market convention for testing the postgres impl):

```ts
import { createPostgresMarketCacheRepository } from "../src/cache-repository.ts";

test("postgres listStaleActiveListings passes [now, activeSince, limit] and maps rows", async () => {
  const calls: { text: string; values?: unknown[] }[] = [];
  const fakeDb = {
    async query<R>(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return {
        rows: [
          { listing_id: "11111111-1111-4111-a111-111111111111" },
          { listing_id: "22222222-2222-4222-a222-222222222222" },
        ] as unknown as R[],
      };
    },
  };
  const repo = createPostgresMarketCacheRepository(fakeDb);

  const result = await repo.listStaleActiveListings({
    now: "2026-06-03T00:00:00.000Z",
    activeSince: "2026-05-27T00:00:00.000Z",
    limit: 200,
  });

  assert.deepEqual(result, [
    { kind: "listing", id: "11111111-1111-4111-a111-111111111111" },
    { kind: "listing", id: "22222222-2222-4222-a222-222222222222" },
  ]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].values, [
    "2026-06-03T00:00:00.000Z",
    "2026-05-27T00:00:00.000Z",
    200,
  ]);
  // The query dedups to each listing's latest row before filtering.
  assert.match(calls[0].text, /distinct on \(listing_id\)/);
  assert.match(calls[0].text, /expires_at < \$1/);
  assert.match(calls[0].text, /fetched_at > \$2/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/market && node --experimental-strip-types --test test/cache-repository.test.ts`
Expected: FAIL — `repo.listStaleActiveListings is not a function` (postgres impl lacks it).

- [ ] **Step 3: Implement it in the postgres repository**

In `createPostgresMarketCacheRepository`, add this method to the returned object (after `storeBars`):

```ts
    async listStaleActiveListings({ now, activeSince, limit }) {
      const { rows } = await db.query<{ listing_id: string }>(
        `select listing_id
           from (
             select distinct on (listing_id) listing_id, expires_at, fetched_at
               from market_quote_snapshots
              order by listing_id, fetched_at desc, as_of desc
           ) latest
          where latest.expires_at < $1::timestamptz
            and latest.fetched_at > $2::timestamptz
          order by latest.fetched_at desc
          limit $3`,
        [now, activeSince, limit],
      );
      return rows.map((row) => Object.freeze({ kind: "listing" as const, id: row.listing_id }));
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/market && node --experimental-strip-types --test test/cache-repository.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/market/src/cache-repository.ts services/market/test/cache-repository.test.ts
git commit -m "feat(market): listStaleActiveListings postgres impl (latest-row stale+active)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `runQuoteRefreshOnce` orchestrator

**Files:**
- Create: `services/market/src/quote-refresh.ts`
- Test: `services/market/test/quote-refresh.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/market/test/quote-refresh.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import type { MarketDataAdapter } from "../src/adapter.ts";
import { available, unavailable } from "../src/availability.ts";
import { createInMemoryMarketCacheRepository } from "../src/cache-repository.ts";
import { normalizedQuote } from "../src/quote.ts";
import { runQuoteRefreshOnce } from "../src/quote-refresh.ts";

const SOURCE_ID = "00000000-0000-4000-a000-000000000009";
const A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const NOW = new Date("2026-06-03T00:00:00.000Z");
const clock = () => NOW;

async function seedStaleActive(
  repo: ReturnType<typeof createInMemoryMarketCacheRepository>,
  id: string,
): Promise<void> {
  await repo.storeQuote(
    normalizedQuote({
      listing: { kind: "listing", id },
      price: 10,
      prev_close: 9,
      session_state: "regular",
      as_of: "2026-06-02T00:00:00.000Z",
      delay_class: "delayed_15m",
      currency: "USD",
      source_id: SOURCE_ID,
    }),
    {
      provider: "polygon_market",
      fetched_at: "2026-06-02T12:00:00.000Z",
      expires_at: "2026-06-02T12:30:00.000Z",
    },
  );
}

function quoteFor(id: string) {
  return normalizedQuote({
    listing: { kind: "listing", id },
    price: 20,
    prev_close: 19,
    session_state: "regular",
    as_of: NOW.toISOString(),
    delay_class: "delayed_15m",
    currency: "USD",
    source_id: SOURCE_ID,
  });
}

test("runQuoteRefreshOnce refreshes each stale-active listing and tallies results", async () => {
  const cache = createInMemoryMarketCacheRepository();
  await seedStaleActive(cache, A);
  await seedStaleActive(cache, B);
  const seen: string[] = [];
  const adapter: MarketDataAdapter = {
    providerName: "fake",
    sourceId: SOURCE_ID,
    async getQuote({ listing }) {
      seen.push(listing.id);
      return available(quoteFor(listing.id));
    },
    async getBars() {
      throw new Error("unused");
    },
  };

  const summary = await runQuoteRefreshOnce({ cache, adapter, clock });

  assert.deepEqual(summary, { scanned: 2, refreshed: 2, failed: 0 });
  assert.deepEqual([...seen].sort(), [A, B].sort());
});

test("runQuoteRefreshOnce counts an unavailable provider as failed and logs it", async () => {
  const cache = createInMemoryMarketCacheRepository();
  await seedStaleActive(cache, A);
  const events: unknown[] = [];
  const adapter: MarketDataAdapter = {
    providerName: "fake",
    sourceId: SOURCE_ID,
    async getQuote({ listing }) {
      return unavailable({
        reason: "provider_error",
        listing,
        source_id: SOURCE_ID,
        as_of: NOW.toISOString(),
        retryable: true,
        detail: "boom",
      });
    },
    async getBars() {
      throw new Error("unused");
    },
  };

  const summary = await runQuoteRefreshOnce({
    cache,
    adapter,
    clock,
    log: (event) => events.push(event),
  });

  assert.deepEqual(summary, { scanned: 1, refreshed: 0, failed: 1 });
  assert.equal(events.length, 1);
});

test("runQuoteRefreshOnce does nothing when no listings are stale-active", async () => {
  const cache = createInMemoryMarketCacheRepository();
  let called = 0;
  const adapter: MarketDataAdapter = {
    providerName: "fake",
    sourceId: SOURCE_ID,
    async getQuote({ listing }) {
      called++;
      return available(quoteFor(listing.id));
    },
    async getBars() {
      throw new Error("unused");
    },
  };

  const summary = await runQuoteRefreshOnce({ cache, adapter, clock });

  assert.deepEqual(summary, { scanned: 0, refreshed: 0, failed: 0 });
  assert.equal(called, 0);
});

test("runQuoteRefreshOnce passes the limit through to the cache query", async () => {
  const cache = createInMemoryMarketCacheRepository();
  await seedStaleActive(cache, A);
  await seedStaleActive(cache, B);
  let called = 0;
  const adapter: MarketDataAdapter = {
    providerName: "fake",
    sourceId: SOURCE_ID,
    async getQuote({ listing }) {
      called++;
      return available(quoteFor(listing.id));
    },
    async getBars() {
      throw new Error("unused");
    },
  };

  const summary = await runQuoteRefreshOnce({ cache, adapter, clock, limit: 1 });

  assert.equal(summary.scanned, 1);
  assert.equal(called, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/market && node --experimental-strip-types --test test/quote-refresh.test.ts`
Expected: FAIL — cannot find module `../src/quote-refresh.ts`.

- [ ] **Step 3: Implement the orchestrator**

Create `services/market/src/quote-refresh.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/market && node --experimental-strip-types --test test/quote-refresh.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add services/market/src/quote-refresh.ts services/market/test/quote-refresh.test.ts
git commit -m "feat(market): runQuoteRefreshOnce orchestrator for stale-active quotes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Extract `createMarketStackFromEnv` builder

**Files:**
- Create: `services/market/src/stack.ts`
- Modify: `services/market/src/dev.ts`
- Test: `services/market/test/stack.test.ts`

This extracts the provider/cache/adapter construction (currently top-level in `dev.ts`) into a reusable builder so the worker can build the same stack without starting the HTTP server. Behavior is unchanged.

- [ ] **Step 1: Write the failing test**

Create `services/market/test/stack.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { createMarketStackFromEnv } from "../src/stack.ts";

test("createMarketStackFromEnv throws without DATABASE_URL", () => {
  assert.throws(() => createMarketStackFromEnv({}), /DATABASE_URL/);
});

test("createMarketStackFromEnv builds a cached adapter stack", async () => {
  const stack = createMarketStackFromEnv({
    DATABASE_URL: "postgres://localhost:5432/market_agent_unused",
  });
  assert.equal(typeof stack.adapter.getQuote, "function");
  assert.equal(typeof stack.cache.listStaleActiveListings, "function");
  assert.ok(stack.pool);
  // The pool is lazy; ending an unused pool resolves cleanly.
  await stack.pool.end();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/market && node --experimental-strip-types --test test/stack.test.ts`
Expected: FAIL — cannot find module `../src/stack.ts`.

- [ ] **Step 3: Create the builder**

Create `services/market/src/stack.ts` (this is `dev.ts` lines 23–92, parameterized on `env` and returning the stack):

```ts
import { Pool } from "pg";

import type { MarketDataAdapter } from "./adapter.ts";
import { createDevProvidersMarketDataAdapter } from "./adapters/dev-providers.ts";
import { createPolygonAdapter, createPolygonHttpFetcher } from "./adapters/polygon.ts";
import { createStooqMarketDataAdapter } from "./adapters/stooq.ts";
import { createCachedMarketDataAdapter } from "./cached-adapter.ts";
import {
  createPostgresMarketCacheRepository,
  type MarketCacheRepository,
} from "./cache-repository.ts";
import {
  createPostgresListingRepository,
  listingResolverFromRepository,
} from "./listings.ts";
import { createDailyBarsAwareFallbackMarketDataAdapter } from "./provider-composition.ts";
import {
  POLYGON_MARKET_SOURCE_ID,
  STOOQ_MARKET_SOURCE_ID,
  YAHOO_FINANCE_DEV_MARKET_SOURCE_ID,
  stooqMarketProviderConfigFromEnv,
} from "./provider-sources.ts";
import { createUnavailableMarketDataAdapter } from "./unavailable-adapter.ts";

export type MarketStack = {
  pool: Pool;
  listings: ReturnType<typeof createPostgresListingRepository>;
  cache: MarketCacheRepository;
  adapter: MarketDataAdapter;
};

// Builds the market provider stack (pool, listing repo, cache, cached adapter)
// from environment config. Extracted from dev.ts so both the HTTP server and the
// refresh worker construct an identical stack without duplicating provider wiring.
export function createMarketStackFromEnv(env: NodeJS.ProcessEnv): MarketStack {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the market service");
  }
  const polygonApiKey = env.POLYGON_API_KEY?.trim();
  const pool = new Pool({ connectionString: databaseUrl });
  const listings = createPostgresListingRepository(pool);
  const cache = createPostgresMarketCacheRepository(pool);
  const unofficialDevProvidersEnabled = env.ENABLE_UNOFFICIAL_DEV_PROVIDERS === "true";
  const devProvidersBaseUrl = env.DEV_PROVIDERS_BASE_URL ?? env.DEV_PROVIDERS_ORIGIN;
  const stooqConfig = stooqMarketProviderConfigFromEnv(env);
  const polygonProvider = polygonApiKey
    ? createPolygonAdapter({
        sourceId: POLYGON_MARKET_SOURCE_ID,
        delayClass: "delayed_15m",
        fetcher: createPolygonHttpFetcher({
          apiKey: polygonApiKey,
          baseUrl: env.POLYGON_API_BASE_URL,
        }),
        resolveListing: listingResolverFromRepository(listings),
      })
    : createUnavailableMarketDataAdapter({
        providerName: "polygon",
        sourceId: POLYGON_MARKET_SOURCE_ID,
        detail: "POLYGON_API_KEY is not configured",
        retryable: unofficialDevProvidersEnabled || stooqConfig.enabled,
      });
  const resolveMarketListing = async (listing: { id: string }) => {
    const record = await listings.find(listing.id);
    if (!record) throw new Error(`listing not found: ${listing.id}`);
    return {
      ticker: record.ticker,
      mic: record.mic,
      currency: record.trading_currency,
      timezone: record.timezone,
    };
  };
  const devProvidersAdapter = unofficialDevProvidersEnabled && devProvidersBaseUrl
    ? createDevProvidersMarketDataAdapter({
        baseUrl: devProvidersBaseUrl,
        sourceId: YAHOO_FINANCE_DEV_MARKET_SOURCE_ID,
        resolveListing: resolveMarketListing,
      })
    : null;
  const stooqAdapter = stooqConfig.enabled
    ? createStooqMarketDataAdapter({
        baseUrl: stooqConfig.baseUrl,
        sourceId: STOOQ_MARKET_SOURCE_ID,
        resolveListing: resolveMarketListing,
      })
    : null;
  const provider = devProvidersAdapter || stooqAdapter
    ? createDailyBarsAwareFallbackMarketDataAdapter({
        providerName: "market-provider-fallback",
        realtimeAdapters: [
          polygonProvider,
          ...(devProvidersAdapter ? [devProvidersAdapter] : []),
        ],
        dailyBarsFallbackAdapters: [
          ...(stooqAdapter ? [stooqAdapter] : []),
        ],
        isRealtimeFallbackEligible: (outcome, adapter) =>
          adapter.providerName === "polygon" &&
          outcome.outcome === "unavailable" &&
          outcome.detail === "polygon: HTTP 403",
      })
    : polygonProvider;
  const adapter = createCachedMarketDataAdapter({ provider, cache });
  return { pool, listings, cache, adapter };
}
```

- [ ] **Step 4: Refactor `dev.ts` to use the builder**

Replace the entire contents of `services/market/src/dev.ts` with:

```ts
import { createMarketServer } from "./http.ts";
import { createMarketStackFromEnv } from "./stack.ts";

const host = process.env.MARKET_HOST ?? "127.0.0.1";
const port = Number(process.env.MARKET_PORT ?? "4321");

const { pool, listings, adapter } = createMarketStackFromEnv(process.env);

const server = createMarketServer({ adapter, listings });
server.listen(port, host, () => {
  console.log(`market listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd services/market && node --experimental-strip-types --test test/stack.test.ts`
Expected: PASS (2 tests).

Run the full market suite to confirm the `dev.ts` refactor broke nothing:
Run: `cd services/market && npm test`
Expected: PASS (all existing tests + new ones).

- [ ] **Step 6: Commit**

```bash
git add services/market/src/stack.ts services/market/src/dev.ts services/market/test/stack.test.ts
git commit -m "refactor(market): extract createMarketStackFromEnv builder from dev.ts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `refresh-worker.ts` entry + package script

**Files:**
- Create: `services/market/src/refresh-worker.ts`
- Modify: `services/market/package.json`

The worker `main()` needs a real database and provider stack, so (matching `services/notifications/src/worker.ts`, whose `main()` has no unit test) it is verified by a manual smoke run; the testable logic lives in `runQuoteRefreshOnce` (Task 3) and `createMarketStackFromEnv` (Task 4).

- [ ] **Step 1: Create the worker entry**

Create `services/market/src/refresh-worker.ts`:

```ts
import { fileURLToPath } from "node:url";

import { runQuoteRefreshOnce } from "./quote-refresh.ts";
import { createMarketStackFromEnv } from "./stack.ts";

const DEFAULT_ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_LIMIT = 200;

function integerEnv(name: string): number | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${name} must be a positive integer`);
  return Number(value);
}

async function main(): Promise<void> {
  const stack = createMarketStackFromEnv(process.env);
  try {
    const summary = await runQuoteRefreshOnce({
      cache: stack.cache,
      adapter: stack.adapter,
      activeWindowMs: integerEnv("QUOTE_REFRESH_ACTIVE_WINDOW_MS") ?? DEFAULT_ACTIVE_WINDOW_MS,
      limit: integerEnv("QUOTE_REFRESH_LIMIT") ?? DEFAULT_LIMIT,
    });
    console.log(JSON.stringify(summary));
  } finally {
    await stack.pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
```

- [ ] **Step 2: Add the package script**

In `services/market/package.json`, add to `"scripts"` (alongside `"dev"` and `"test"`):

```json
    "refresh": "node --experimental-strip-types src/refresh-worker.ts",
```

- [ ] **Step 3: Verify it parses and the suite is green**

Run: `cd services/market && npm test`
Expected: PASS (all tests).

Confirm the worker module loads without executing `main()` (the import.meta guard prevents auto-run on import):
Run: `cd services/market && node --experimental-strip-types --input-type=module -e "import('./src/refresh-worker.ts').then(() => console.log('loaded'))"`
Expected: prints `loaded` with no DB connection attempt.

- [ ] **Step 4: Manual smoke run (optional, requires dev DB up)**

With the dev Postgres running and env configured (`DATABASE_URL`, optionally `POLYGON_API_KEY`/`ENABLE_UNOFFICIAL_DEV_PROVIDERS`):
Run: `cd services/market && npm run refresh`
Expected: prints a JSON line like `{"scanned":N,"refreshed":M,"failed":K}` and exits 0.

- [ ] **Step 5: Commit**

```bash
git add services/market/src/refresh-worker.ts services/market/package.json
git commit -m "feat(market): quote refresh worker entry + refresh script

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- `listStaleActiveListings` query (spec Unit 1) → Tasks 1–2. ✓
- `runQuoteRefreshOnce` orchestrator (spec Unit 2) → Task 3. ✓
- `refresh-worker.ts` entry + reuse of construction (spec Unit 3) → Tasks 4–5. ✓
- Config env vars `QUOTE_REFRESH_ACTIVE_WINDOW_MS` / `QUOTE_REFRESH_LIMIT` (spec Configuration) → Task 5. ✓
- Error handling: per-listing failure tallied+logged, loop continues; infra failure propagates (spec Error handling) → Task 3 (loop) + Task 5 (`main` catch). ✓
- Testing: in-memory semantics + postgres contract + orchestrator units (spec Testing) → Tasks 1–3. ✓
- Out-of-scope items (scheduler, concurrency, watchlist coupling) → not implemented. ✓

**Type consistency:** `listStaleActiveListings({ now, activeSince, limit })` returns `ReadonlyArray<ListingSubjectRef>` in the interface (Task 1), both impls (Tasks 1–2), and is consumed in Task 3 with `now`/`activeSince` as ISO strings produced from `clock()`. `QuoteRefreshDeps`/`QuoteRefreshSummary` defined in Task 3 are reused unchanged in Task 5. `MarketStack` (Task 4) fields (`pool`, `cache`, `adapter`) match Task 5 usage. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test shows real assertions. ✓
