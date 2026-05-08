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

- `createPostgresListingRepository` when `DATABASE_URL` is present, so listings discovered by the resolver can be quoted. Without a database URL it falls back to `createInMemoryListingRepository(DEV_LISTINGS)` for AAPL, MSFT, GOOGL, TSLA, and NVDA.
- `createPolygonHttpFetcher` when `POLYGON_API_KEY` is present. Seeded fixture tickers still fall back to `createDevPolygonFetcher` if live Polygon rejects the request, so local AAPL/MSFT/GOOGL/TSLA/NVDA demos keep working with restricted API keys.
- `DEV_POLYGON_SOURCE_ID` — a real UUID v4 (not a stub sentinel) carried through as `quote.source_id` so consumers can verify the live wiring.

`POLYGON_API_BASE_URL` can point the Polygon quote/bar fetcher at a mock server
in tests.

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
