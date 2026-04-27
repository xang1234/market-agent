# Screener

Tracking beads: `fra-cw0.7` and child beads `fra-cw0.7.1` … `fra-cw0.7.4`.

The screening service: structured filter-and-rank query envelopes, result-row
contracts, and persistable `screen` subjects (spec §6.7.1). Internally the
service reads from `services/market` and `services/fundamentals`; clients
must consume `/v1/screener/*` rather than fanning out across those upstreams
and inventing their own join semantics.

## Status

- `fra-cw0.7.1` — query envelope + validator (`src/query.ts`, `src/fields.ts`)
- `fra-cw0.7.2` — result-row + response envelope (`src/result.ts`, `src/subject-ref.ts`)
- `fra-cw0.7.3` — persistable `screen` subject + replay (`src/screen-subject.ts`)
- `fra-cw0.7.4` — executor + HTTP runtime (`src/candidate.ts`, `src/executor.ts`,
  `src/screen-repository.ts`, `src/http.ts`, `src/dev.ts`)

## Commands

```bash
cd services/screener
npm test                    # all unit + HTTP integration tests
npm run dev                 # start dev server on 127.0.0.1:4323
```

## Runtime (cw0.7.4)

The executor is a pure pipeline over a pre-hydrated candidate registry —
filter → sort → page → assemble — keyed off the closed field registry from
cw0.7.1. Pre-hydration is a deliberate architectural choice: the executor
must not fan out N×K HTTP calls to `services/market` and
`services/fundamentals` per query. A future poller will keep the registry
fresh; for now `src/dev-candidates.ts` seeds AAPL/MSFT/GOOGL/TSLA/NVDA
with listing UUIDs that match `services/market`'s dev fixtures so the
symbol-entry handoff lands on the same canonical identity.

Two semantics worth flagging because they are easy to get wrong:

1. **Numeric clauses on `null` fields exclude the candidate.** Otherwise
   `pe_ratio > 5` would silently match loss-makers that have no P/E.
2. **`null`s always sort last**, regardless of `asc`/`desc` direction —
   otherwise `asc` would parade no-data rows to the top.

`POST /v1/screener/screens/:id/replay` re-runs the persisted query through
the executor every call (fresh `as_of`); it never returns cached rows.
This is the cw0.7.3 contract enforced at the HTTP boundary.

| Endpoint                                       | Purpose                          |
| ---------------------------------------------- | -------------------------------- |
| `GET  /healthz`                                | service identity                 |
| `POST /v1/screener/search`                     | run a query, return rows         |
| `POST /v1/screener/screens`                    | create or replace a saved screen |
| `GET  /v1/screener/screens`                    | list saved screens               |
| `GET  /v1/screener/screens/:id`                | fetch one saved screen           |
| `DELETE /v1/screener/screens/:id`              | delete a saved screen            |
| `POST /v1/screener/screens/:id/replay`         | re-execute a saved screen        |

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

## Persistable `screen` subject

A `screen` is a canonical SubjectKind in its own right (one of seven —
issuer/instrument/listing/theme/macro_topic/portfolio/screen). It is
the *named, persisted screener query* that downstream subjects (dynamic
watchlists, themes, agents) reference when they want to "include the
universe from screen X."

```ts
type ScreenSubject = {
  screen_id: UUID;
  name: string;                       // <= 200 chars, non-empty
  definition: ScreenerQuery;          // frozen, canonicalized
  created_at: string;                 // ISO 8601 UTC
  updated_at: string;                 // >= created_at
};

type ScreenSubjectRef = { kind: "screen"; id: UUID };
```

The defining contract is **"reopen runs the query; does NOT replay
stale rows."** Three structural enforcements:

1. `ScreenSubject` has no `rows` / `as_of` / `total_count` — a stale
   snapshot has nowhere to live.
2. `definition` is the frozen `ScreenerQuery` envelope (cw0.7.1), not
   a string DSL — replay is byte-for-byte deterministic, no parser.
3. `replayScreen(screen): ScreenerQuery` returns a query, not a
   response. Any caller that wants rows hands the query back to the
   screener service for fresh execution.

```ts
persistScreen({ screen_id, name, definition, created_at, updated_at? })
  → frozen ScreenSubject
replayScreen(screen) → ScreenerQuery     // ready for fresh execution
screenSubjectRef(screen) → { kind: "screen", id: screen.screen_id }
assertScreenSubjectContract(value)        // cross-boundary guard
```
