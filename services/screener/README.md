# Screener

Tracking beads: `fra-cw0.7` and child beads `fra-cw0.7.1` … `fra-cw0.7.3`.

The screening service: structured filter-and-rank query envelopes, result-row
contracts, and persistable `screen` subjects (spec §6.7.1). Internally the
service reads from `services/market` and `services/fundamentals`; clients
must consume `/v1/screener/*` rather than fanning out across those upstreams
and inventing their own join semantics.

## Status

- `fra-cw0.7.1` — query envelope + validator (`src/query.ts`, `src/fields.ts`)
- `fra-cw0.7.2` — result-row + response envelope (`src/result.ts`, `src/subject-ref.ts`)

## Commands

```bash
cd services/screener
npm test
```

## Query envelope contract

Every screener query is one shape: five required dimensions, each bound to
fields from the closed registry in `src/fields.ts`. Two contract-level
invariants the validator enforces at the boundary:

1. **No freeform DSL.** Each clause names a registered field. Adding a new
   queryable field is a registry edit (a contract change), never an opaque
   string passed through to a provider.
2. **No raw provider columns.** Field names are screener-owned (e.g.
   `last_price`, `gross_margin`, `mic`). Provider payload paths
   (`polygon.lastTrade.p`) are rejected.

```ts
type ScreenerQuery = {
  universe: ReadonlyArray<EnumClause>;             // identity / membership
  market: ReadonlyArray<EnumClause | NumericClause>;
  fundamentals: ReadonlyArray<NumericClause>;      // KeyStat / aggregates
  sort: ReadonlyArray<SortSpec>;                   // required, non-empty
  page: { limit: 1..500; offset?: 0+ };
};
```

`normalizedScreenerQuery(input)` returns a frozen, canonicalized envelope
suitable for use as a cache-identity input or as the body of a persisted
`screen` subject (cw0.7.3). `assertScreenerQueryContract(value)` is the
cross-boundary type-narrowing assertion for HTTP handlers and replay.

## Result-row + response contract

Each row is intentionally thinner than symbol-detail hydration: identity +
display + rank + compact quote and fundamentals summaries — sufficient
for screener-table rendering, no more. Selecting a row hands off
`row.subject_ref` (canonical `{kind, id}`) to the symbol-entry flow.

```ts
type ScreenerResultRow = {
  subject_ref: { kind: "issuer" | "instrument" | "listing"; id: UUID };
  display: { primary: string; ticker?; mic?; legal_name?; share_class? };
  rank: number;             // 1-based, strictly increasing across rows
  quote: ScreenerQuoteSummary;        // fixed shape, nullable numerics
  fundamentals: ScreenerFundamentalsSummary;
};

type ScreenerResponse = {
  query: ScreenerQuery;             // echoed for replay / cache identity
  rows: ReadonlyArray<ScreenerResultRow>;
  total_count: number;              // matches before pagination
  page: ScreenerPage;               // must echo query.page exactly
  as_of: string;
  snapshot_compatible: boolean;
};
```

`normalizedScreenerResponse(input)` and `assertScreenerResponseContract(value)`
mirror the query-side helpers: freeze + canonicalize on the trust side,
type-narrow assertion at HTTP/replay boundaries.
