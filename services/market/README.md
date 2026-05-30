# Market

Tracking beads: `fra-cw0.1` (and child beads `fra-cw0.1.1` … `fra-cw0.1.6`).

The market data service: provider-neutral quote and bar contracts (spec
§6.2.1), a polygon adapter, and an HTTP layer that exposes
`/v1/market/quote` to the web client.

## Commands

```bash
cd services/market
npm test         # contract + adapter + http tests
npm run dev      # starts http server on $MARKET_PORT (defaults to 4321)
```

## Dev wiring

`src/dev.ts` boots the HTTP server using:

- `createPostgresListingRepository`; `DATABASE_URL` is required in normal dev so provider-discovered listings can be quoted after restart.
- `createCachedMarketDataAdapter` backed by Postgres quote/bar cache tables.
- `createPolygonHttpFetcher` when `POLYGON_API_KEY` is present. Without a key, requests return unavailable envelopes instead of fixture quotes.
- `POLYGON_MARKET_SOURCE_ID` carried through as `quote.source_id` / `bars.source_id` so consumers can verify provider provenance.

`POLYGON_API_BASE_URL` can point the Polygon quote/bar fetcher at a mock server
in tests.

The open datasource slice also registers `stooq_market` as a free
`market_data` source. `STOOQ_MARKET_ENABLED` and `STOOQ_MARKET_BASE_URL`
configure the Stooq adapter. Stooq is an EOD fallback only: it is eligible for
`1d` historical bars when paid coverage is missing or unavailable, and it
returns unavailable for quotes and intraday intervals rather than pretending to
be realtime market data. The dev server routes Stooq only through the daily-bars
fallback path so quote and intraday requests never use it.

Rate-limit expectation: Stooq fallback requests are public EOD CSV downloads,
not a paid realtime feed. Keep `STOOQ_MARKET_ENABLED` opt-in, avoid live Stooq
checks in CI, and rely on the fixture smoke test below for repeatable fallback
coverage.

### Verification

Run the fixture smoke from the repository root to prove a paid daily-bars miss
can fall through to Stooq `1d` EOD coverage without using Stooq for realtime
quotes:

```bash
node --experimental-strip-types --test scripts/open-datasource-coverage.test.ts
```

Run `cd services/market && npm test` for the market slice. Stooq provenance is
`stooq_market`, and Stooq EOD bars must stay labeled as free EOD source data,
not realtime quote data.

## Provider fallback plan

Use `createFallbackMarketDataAdapter` when a deployment has more than one
provider for the same listing universe. Configure providers in preference
order. The wrapper records an audit event for each provider attempt, including
operation, result, latency, reason, and whether the outcome was eligible for
fallback.

Fallback is attempted only for retryable unavailable outcomes or thrown provider
errors. Non-retryable provider errors and missing coverage stop the chain, so a
bad credential, unsupported listing, or contract violation is not hidden by a
later provider. Each fallback provider must still emit the same normalized quote
and bars contracts; downstream consumers should inspect `source_id` on the
served payload to see which provider ultimately supplied data.
