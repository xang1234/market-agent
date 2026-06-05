# Analyst-Consensus Ingestion (fra-tcav) — Design

**Bead:** `fra-tcav` · blocks `fra-6syg` (analyst_consensus + price_target_range emitters)

**Goal:** Make `ConsensusRepository.find(issuer)` return a real `AnalystConsensusEnvelope`
for real issuers — it returns `null` in prod today (`createUnsupportedConsensusRepository`).
This unblocks `fra-6syg`'s blocks and also lights up Symbol Overview's currently-404
consensus panel.

**Architecture:** Consensus joins the existing dev-provider family. `earnings`/`holders`/
`profile` are already served by the Python `dev-providers` sidecar (real yfinance/finviz
data, gated behind `ENABLE_UNOFFICIAL_DEV_PROVIDERS`, gracefully `null` otherwise). This
adds a `/fundamentals/consensus` sidecar endpoint, a `createDevProvidersConsensusRepository`
TS repo mirroring earnings, and conditional wiring in `dev.ts`.

**Tech stack:** Python FastAPI + yfinance (`services/dev-providers`), Node
`--experimental-strip-types` (`services/fundamentals`).

---

## Scope boundary

`fra-tcav` delivers **only the envelope**. The interface between this bead and `fra-6syg`
is the `AnalystConsensusEnvelope` returned by `ConsensusRepository`. Explicitly **out of
scope** (all `fra-6syg`):

- analyst metric_keys seed (`analyst_count`, `analyst_rating_*`, `price_target_*`) — needed
  only for fact materialization.
- the materializer, block builders, snapshot helpers, playbook sections, web rendering.
- `price_target_range`'s **current price** (`current_price_ref`) — comes from the market/
  quote service, not the consensus envelope.

This keeps `fra-tcav` small and independently testable.

---

## yfinance reality (verified)

yfinance supplies, via `Ticker.info` and `Ticker.recommendations_summary`:

- `numberOfAnalystOpinions` → `analyst_count`
- `targetLow/Mean/Median/HighPrice` + `currency` → `price_target`
- strongBuy/buy/hold/sell/strongSell counts → `rating_distribution`

It does **NOT** supply forward EPS/revenue estimates. So the envelope's `estimates` array
is always `[]`; `buildAnalystConsensus` emits its existing `missing_estimates` coverage
warning, which is honest. The analyst_consensus and price_target_range blocks do not need
estimates.

Analyst coverage is sparse for micro-cap / non-US tickers — fields are optional in `.info`
and must be checked defensively.

---

## Components

### 1. Python sidecar (`services/dev-providers/`)

- `yfinance_provider.py`: add `analyst_consensus(*, ticker, mic) -> dict | None`. Builds
  `yf.Ticker(yahoo_symbol_for_listing(ticker, mic))`, reads `.info` (analyst count, price
  targets, currency) and `.recommendations_summary` (rating counts), and delegates to a
  pure normalizer.
- A pure `normalize_analyst_consensus(info, rec_rows, now_iso) -> dict | None` helper
  (unit-testable like `normalize_earnings_events`); returns `None` when there is no analyst
  coverage at all (no count, no targets, no ratings).
- `main.py`: add `POST /fundamentals/consensus` mirroring the `/fundamentals/earnings`
  handler — same `ticker`/`mic` body, negative cache key `fundamentals-consensus:{ticker}:
  {mic}`, `_bounded_call("yfinance", …)`, `_available`/`_cache_unavailable`.

**Sidecar `data` payload shape:**

```json
{
  "as_of": "2026-06-04T12:00:00.000Z",
  "currency": "USD",
  "analyst_count": 41,
  "rating_distribution": { "strong_buy": 14, "buy": 17, "hold": 8, "sell": 1, "strong_sell": 1 },
  "price_target": { "low": 170, "mean": 220.5, "median": 215, "high": 280 }
}
```

`rating_distribution` and `price_target` are each `null` when unavailable. No `estimates`.

### 2. TS repository (`services/fundamentals/src/dev-provider-fundamentals.ts`)

`createDevProvidersConsensusRepository(options)` mirrors `createDevProvidersEarningsRepository`:

```
find(issuer_id):
  context = issuerSidecarContext(profiles, issuer_id)        // null -> null
  envelope = postSidecar('/fundamentals/consensus', sidecarListingBody(context.listing))
  if envelope.status !== 'available':
    return null if reason === 'missing_coverage' else throw sidecarUnavailableError(...)
  input = sidecarConsensusInput(envelope.data, issuer_id, context.listing.currency, sourceId)
  return buildAnalystConsensus(input)            // throws -> providerPayloadError
```

`sidecarConsensusInput(data, issuerId, fallbackCurrency, sourceId)` → `BuildAnalystConsensusInput`
with **validation discipline**:

- `subject = { kind: 'issuer', id: issuerId }`, `as_of = data.as_of`.
- `analyst_count = max(data.analyst_count ?? 0, sum(rating counts))`. The builder enforces
  `contributor_count <= analyst_count`, and yfinance's `numberOfAnalystOpinions` can be
  smaller than its rating-count sum — taking the max keeps both sub-envelopes valid.
- `rating_distribution`: only when `data.rating_distribution` present; set
  `contributor_count = sum(counts)` (the builder asserts counts sum to contributor_count).
- `price_target`: only when `data.price_target` present **and** `low <= median <= high` and
  `low <= mean <= high` (omit on ordering violation rather than throw); `currency` from
  payload or `fallbackCurrency`; `contributor_count = analyst_count`.
- `estimates: []`.

Omitting an inconsistent sub-envelope (and taking the max for `analyst_count`) means partial
or internally-disagreeing yfinance coverage still yields a useful envelope instead of a hard
failure.

`source_id = YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID` (threaded through `options.sourceId`,
same as earnings/holders).

### 3. Wiring (`dev-providers.ts` + `dev.ts`)

- Add `consensus: ConsensusRepository` to `DevProviderRuntime`; construct it in
  `createDevProviderRuntime` via `createDevProvidersConsensusRepository`.
- `dev.ts`: change the one hard-wired line to
  `const consensus = devProviderRuntime?.consensus ?? createUnsupportedConsensusRepository();`

---

## Error handling / degradation

- No analyst coverage → sidecar `unavailable/missing_coverage` → repo `null` → endpoint 404
  (graceful, same as earnings).
- Partial coverage → envelope carries the available sub-part + `buildAnalystConsensus`
  coverage warnings.
- Sidecar disabled (`ENABLE_UNOFFICIAL_DEV_PROVIDERS` off) → unchanged: unsupported repo →
  `null`.

---

## Testing

- **TS** (`services/fundamentals/test/dev-providers.test.ts`): consensus repo with a fake
  `fetchImpl` returning a canned `available` envelope → assert the mapped
  `AnalystConsensusEnvelope` (analyst_count, `rating_distribution.counts`, `price_target`,
  `source_id`, and the request URL `/fundamentals/consensus` + body); plus the
  partial-coverage path (price_target only → `rating_distribution` null) and the
  `unavailable → null` path.
- **Python** (`services/dev-providers/tests/test_yfinance_provider.py`):
  `normalize_analyst_consensus` unit tests — full payload, targets-only, and
  no-coverage → `None`.
- The live yfinance path is a manual/gated check, not CI (consistent with the unofficial-
  provider posture; FastAPI HTTP endpoints aren't integration-tested today).

---

## Acceptance

- `createDevProvidersConsensusRepository` maps a canned sidecar envelope to a valid
  `AnalystConsensusEnvelope`; partial and unavailable paths handled.
- `normalize_analyst_consensus` produces the documented payload from yfinance-shaped input
  and returns `None` on no coverage.
- `dev.ts` wires `consensus` to the dev-provider runtime when enabled, unsupported otherwise.
- With the sidecar enabled, `GET /v1/fundamentals/consensus?subject_id=<covered issuer>`
  returns a non-null envelope (manual verification).
