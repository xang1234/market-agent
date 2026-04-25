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

- `createInMemoryListingRepository(DEV_LISTINGS)` — fixture listing UUIDs (AAPL, MSFT, GOOGL, TSLA, NVDA) wired to ticker/MIC/currency/timezone.
- `createDevPolygonFetcher` — returns canned snapshot payloads for those tickers, so no real polygon API key is needed locally.
- `DEV_POLYGON_SOURCE_ID` — a real UUID v4 (not a stub sentinel) carried through as `quote.source_id` so consumers can verify the live wiring.

For production, swap both deps for DB-backed listing reads and a real polygon
HTTP fetcher reading `POLYGON_API_KEY`.
