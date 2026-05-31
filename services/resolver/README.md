# Resolver

Tracking bead: `fra-6al.3` (P0.3 Identity & resolver service).

This package owns the deterministic boundary that converts lookup input
(user text, provider-origin identity records) into canonical finance
identity outputs: `issuer`, `instrument`, `listing`, or a typed `SubjectRef`.

## Current scope: `fra-6al.3` — resolver service

This package includes the resolver envelope, free-text normalization,
database-backed lookup entry points, and the `/v1/subjects/resolve` HTTP
handler. Every resolver call returns one of three outcomes:

- `resolved` — one canonical target chosen confidently.
- `ambiguous` — multiple plausible targets; ranked candidates are returned
  without silently picking one.
- `not_found` — input normalizable but not mappable to a supported target.

## Usage

```ts
import { resolved, ambiguous, notFound, isResolved } from "./src/envelope.ts";

const envelope = ambiguous({
  candidates: [
    { subject_ref: { kind: "listing", id: "..." }, display_name: "GOOG", confidence: 0.55 },
    { subject_ref: { kind: "listing", id: "..." }, display_name: "GOOGL", confidence: 0.45 },
  ],
  ambiguity_axis: "multiple_listings",
});

if (isResolved(envelope)) {
  // envelope.subject_ref, envelope.canonical_kind are typed here
}
```

The constructor functions enforce invariants the TypeScript compiler can't:

- `confidence` must be a finite number in `[0, 1]`.
- `ambiguous` requires `>= 2` candidates; single-candidate or empty lists
  must use `resolved` or `not_found` instead.
- Candidates must be sorted by `confidence` descending.
- A `resolved` envelope's `alternatives` must not out-rank the chosen target.

## Dev ticker discovery

`npm run dev` reads `POLYGON_API_KEY` from the environment. When it is present,
`/v1/subjects/resolve` first performs the normal Postgres lookup and, only for
unknown tickers, queries Polygon reference data for active stocks, persists the
canonical issuer/instrument/listing rows, then re-runs the normal resolver path.

`RESOLVER_POLYGON_REFERENCE_BASE_URL` can point the reference client at a mock
server in tests. Missing keys, provider failures, rate limits, and malformed
provider rows degrade to the existing `not_found` response.

## Open reference provider discovery

The open datasource slice includes three resolver reference sources:
`nasdaq_trader_reference`, `openfigi_reference`, and `gleif_reference`.
`NASDAQ_TRADER_REFERENCE_ENABLED`, `OPENFIGI_REFERENCE_ENABLED`, and
`GLEIF_REFERENCE_ENABLED` gate the discovery/enrichment path, with optional
`OPENFIGI_API_KEY` support for OpenFIGI rate limits. The dev server tries
Polygon reference discovery first, then the open reference provider when paid
coverage is unavailable or returns no candidates.

Nasdaq Trader validates active US listed tickers and supplies listing venue,
currency, timezone, and asset-type hints. OpenFIGI may enrich a single
unambiguous security match with FIGI/ISIN metadata. GLEIF may enrich a single
unambiguous legal-name match with LEI and domicile metadata. These providers
fill missing identity fields only; they do not overwrite existing
SEC/Polygon/local issuer or instrument identifiers.

Rate-limit expectation: Nasdaq Trader and GLEIF are unauthenticated public
reference endpoints, while OpenFIGI has stricter unauthenticated limits and can
use `OPENFIGI_API_KEY` for higher live quotas. Keep these providers opt-in,
avoid live-network verification in CI, and prefer the fixture smoke test below
for repeatable coverage checks.

### Verification

Run the fixture smoke from the repository root to prove the paid-miss path can
fall through to Nasdaq Trader, OpenFIGI, and GLEIF without live network access:

```bash
node --experimental-strip-types --test scripts/open-datasource-coverage.test.ts
```

Run `cd services/resolver && npm test` for the resolver slice. The fixture tests
cover successful enrichment, provider failures, ambiguous FIGI/LEI matches, and
the rule that open reference providers fill missing identity fields only.

## Tests

```bash
cd services/resolver
npm test
npm run dev
```
