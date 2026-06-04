# Analyst-Consensus Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ConsensusRepository.find(issuer)` return a real `AnalystConsensusEnvelope` for real issuers via the yfinance dev-provider sidecar (bead `fra-tcav`), unblocking `fra-6syg` and lighting up Symbol Overview's 404 consensus panel.

**Architecture:** Consensus joins the dev-provider family (like `earnings`/`holders`): a Python sidecar `/fundamentals/consensus` endpoint backed by a pure `normalize_analyst_consensus`, a `createDevProvidersConsensusRepository` TS repo mirroring earnings, and one-line conditional wiring in `dev.ts`.

**Tech Stack:** Python FastAPI + yfinance (`services/dev-providers`), Node `--experimental-strip-types` (`services/fundamentals`).

---

## Background the engineer needs

- **Run Python tests** from `services/dev-providers`:
  `python3 -m unittest tests.test_yfinance_provider`
  The normalizers in `yfinance_fundamentals.py` are pure (yfinance is imported lazily only inside `YFinanceProvider` methods), so these tests run without yfinance installed.
- **Run fundamentals TS tests** from `services/fundamentals`:
  `node --experimental-strip-types --test test/dev-providers.test.ts` (whole suite: `test/**/*.test.ts`).
  `services/fundamentals` has no tsconfig — strip-types only, so runtime tests are the gate.
- **The consensus builder (`buildAnalystConsensus`) throws only on STRUCTURAL problems** (wrong types, negative counts, invalid currency/ISO/UUID via `assert*`). Consistency issues (rating sum vs `contributor_count`, price ordering, `contributor_count` vs `analyst_count`) become **coverage warnings, not throws**. So the mapper must produce *structurally complete* sub-objects (all 5 rating buckets present) or omit them; the `max()`/`contributor_count=sum`/omit-on-ordering rules just keep envelopes clean and warning-free.
- **yfinance reality:** supplies analyst_count, price targets, rating counts — but NO forward estimates, so `estimates: []` (the existing `missing_estimates` warning fires, which is honest).
- **Source id:** `YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID` (already threaded as `options.sourceId`, same as earnings/holders).

---

## File Structure

**Modify:**
- `services/dev-providers/dev_providers/yfinance_fundamentals.py` — add pure `normalize_analyst_consensus` + `_nonnegative_int` helper.
- `services/dev-providers/dev_providers/yfinance_provider.py` — add `YFinanceProvider.analyst_consensus`; import the new normalizer.
- `services/dev-providers/dev_providers/main.py` — add `POST /fundamentals/consensus`.
- `services/dev-providers/tests/test_yfinance_provider.py` — add normalizer tests.
- `services/fundamentals/src/dev-provider-fundamentals.ts` — add `createDevProvidersConsensusRepository` + `sidecarConsensusInput` + 2 helpers.
- `services/fundamentals/src/dev-providers.ts` — add `consensus` to `DevProviderRuntime` + `createDevProviderRuntime`; re-export the new factory.
- `services/fundamentals/src/dev.ts` — wire `consensus` to the runtime.
- `services/fundamentals/test/dev-providers.test.ts` — add 3 consensus repo tests.

---

## Task 1: Python normalizer (pure, TDD)

**Files:**
- Modify: `services/dev-providers/dev_providers/yfinance_fundamentals.py`
- Test: `services/dev-providers/tests/test_yfinance_provider.py`

- [ ] **Step 1: Write the failing tests**

Add the import to the existing `from dev_providers.yfinance_fundamentals import (...)` block in `tests/test_yfinance_provider.py` so it reads:

```python
from dev_providers.yfinance_fundamentals import (
    normalize_analyst_consensus,
    normalize_earnings_events,
    normalize_holders,
    select_earnings_events,
)
```

Add these test methods inside the `YFinanceProviderTests` class:

```python
    def test_consensus_full_payload(self):
        result = normalize_analyst_consensus(
            {
                "numberOfAnalystOpinions": 41,
                "targetLowPrice": 170,
                "targetMeanPrice": 220.5,
                "targetMedianPrice": 215,
                "targetHighPrice": 280,
            },
            [{"period": "0m", "strongBuy": 14, "buy": 17, "hold": 8, "sell": 1, "strongSell": 1}],
            now_iso="2026-06-04T12:00:00.000Z",
        )
        self.assertIsNotNone(result)
        self.assertEqual(result["analyst_count"], 41)
        self.assertEqual(
            result["rating_distribution"],
            {"strong_buy": 14, "buy": 17, "hold": 8, "sell": 1, "strong_sell": 1},
        )
        self.assertEqual(result["price_target"]["high"], 280)
        self.assertEqual(result["as_of"], "2026-06-04T12:00:00.000Z")

    def test_consensus_targets_only_defaults_median_to_mean(self):
        result = normalize_analyst_consensus(
            {"targetLowPrice": 100, "targetMeanPrice": 120, "targetHighPrice": 140},
            [],
            now_iso="2026-06-04T12:00:00.000Z",
        )
        self.assertIsNotNone(result)
        self.assertEqual(result["analyst_count"], 0)
        self.assertIsNone(result["rating_distribution"])
        self.assertEqual(result["price_target"]["median"], 120)

    def test_consensus_no_coverage_returns_none(self):
        self.assertIsNone(
            normalize_analyst_consensus({}, [], now_iso="2026-06-04T12:00:00.000Z")
        )
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `services/dev-providers`):
```
python3 -m unittest tests.test_yfinance_provider
```
Expected: FAIL with `ImportError: cannot import name 'normalize_analyst_consensus'`.

- [ ] **Step 3: Implement the normalizer**

In `services/dev-providers/dev_providers/yfinance_fundamentals.py`, add the `_nonnegative_int` helper next to `_nonnegative_number`:

```python
def _nonnegative_int(value: Any) -> int | None:
    number = _nonnegative_number(value)
    if number is None:
        return None
    return int(round(number))
```

Add the normalizer + its two private helpers (place near `normalize_holders`):

```python
def normalize_analyst_consensus(
    info: dict[str, Any],
    recommendation_rows: list[dict[str, Any]],
    *,
    now_iso: str,
) -> dict[str, Any] | None:
    analyst_count = _nonnegative_int(info.get("numberOfAnalystOpinions"))
    price_target = _consensus_price_target(info)
    rating_distribution = _consensus_rating_distribution(recommendation_rows)
    if analyst_count is None and price_target is None and rating_distribution is None:
        return None
    return {
        "as_of": now_iso,
        "analyst_count": analyst_count or 0,
        "rating_distribution": rating_distribution,
        "price_target": price_target,
    }


def _consensus_price_target(info: dict[str, Any]) -> dict[str, float] | None:
    low = _number(info.get("targetLowPrice"))
    mean = _number(info.get("targetMeanPrice"))
    median = _number(info.get("targetMedianPrice"))
    high = _number(info.get("targetHighPrice"))
    if low is None or mean is None or high is None:
        return None
    return {
        "low": low,
        "mean": mean,
        "median": median if median is not None else mean,
        "high": high,
    }


def _consensus_rating_distribution(rows: list[dict[str, Any]]) -> dict[str, int] | None:
    row = _latest_recommendation_row(rows)
    if row is None:
        return None
    counts = {
        "strong_buy": _nonnegative_int(_field(row, "strongBuy", "strong_buy")) or 0,
        "buy": _nonnegative_int(_field(row, "buy")) or 0,
        "hold": _nonnegative_int(_field(row, "hold")) or 0,
        "sell": _nonnegative_int(_field(row, "sell")) or 0,
        "strong_sell": _nonnegative_int(_field(row, "strongSell", "strong_sell")) or 0,
    }
    return counts if sum(counts.values()) > 0 else None


def _latest_recommendation_row(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not rows:
        return None
    # yfinance recommendations_summary: the most recent window is period '0m'.
    for row in rows:
        if str(_field(row, "period", "Period") or "").strip() == "0m":
            return row
    return rows[0]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `services/dev-providers`):
```
python3 -m unittest tests.test_yfinance_provider
```
Expected: PASS (existing 10 + 3 new = 13 tests OK).

- [ ] **Step 5: Commit**

```bash
git add services/dev-providers/dev_providers/yfinance_fundamentals.py services/dev-providers/tests/test_yfinance_provider.py
git commit -m "feat(dev-providers): normalize_analyst_consensus (fra-tcav)"
```

---

## Task 2: Python provider method + sidecar endpoint

The yfinance live path and FastAPI HTTP endpoints aren't unit-tested today (only normalizers are). This task adds the glue and verifies it compiles + imports.

**Files:**
- Modify: `services/dev-providers/dev_providers/yfinance_provider.py`
- Modify: `services/dev-providers/dev_providers/main.py`

- [ ] **Step 1: Import the normalizer in the provider**

In `services/dev-providers/dev_providers/yfinance_provider.py`, add `normalize_analyst_consensus` to the existing `from .yfinance_fundamentals import (...)` block (keep alphabetical-ish order; it must appear before `normalize_earnings_events`):

```python
from .yfinance_fundamentals import (
    frame_columns,
    frame_rows,
    normalize_analyst_consensus,
    normalize_earnings_events,
    normalize_holders,
    # ...keep the remaining existing imports unchanged
)
```

- [ ] **Step 2: Add the provider method**

In the `YFinanceProvider` class (after the `earnings` method), add:

```python
    def analyst_consensus(self, *, ticker: str, mic: str, currency: str) -> dict[str, Any] | None:
        symbol = yahoo_symbol_for_listing(ticker, mic)
        import yfinance as yf

        yf_ticker = yf.Ticker(symbol)
        info = self._ticker_info(symbol)
        recommendations = getattr(yf_ticker, "recommendations_summary", None)
        if recommendations is None:
            recommendations = getattr(yf_ticker, "recommendations", None)
        normalized = normalize_analyst_consensus(
            info,
            frame_rows(recommendations),
            now_iso=_iso_utc_millis(datetime.now(UTC)),
        )
        if normalized is None:
            return None
        normalized["currency"] = _currency(currency) or currency
        return normalized
```

- [ ] **Step 3: Add the sidecar endpoint**

In `services/dev-providers/dev_providers/main.py`, add this handler next to the `/fundamentals/earnings` handler:

```python
@app.post("/fundamentals/consensus")
async def fundamentals_consensus(request: Request) -> dict[str, Any]:
    body = await request.json()
    ticker = str(body.get("ticker", "")).strip().upper()
    mic = str(body.get("mic", "")).strip().upper()
    currency = str(body.get("currency", "")).strip().upper()
    key = f"fundamentals-consensus:{ticker}:{mic}"
    cached = _negative_cache_get(key)
    if cached:
        return cached

    try:
        consensus = await _bounded_call(
            "yfinance",
            lambda: _provider.analyst_consensus(ticker=ticker, mic=mic, currency=currency),
        )
    except ValueError as exc:
        return _cache_unavailable(key, ProviderUnavailable("missing_coverage", False, str(exc)))
    except ProviderUnavailable as exc:
        return _cache_unavailable(key, exc)
    except Exception as exc:
        return _cache_unavailable(key, ProviderUnavailable("provider_error", True, f"yfinance: {exc}"))

    if not consensus:
        return _cache_unavailable(
            key,
            ProviderUnavailable("missing_coverage", False, "yfinance: consensus unavailable"),
        )

    return _available(consensus)
```

- [ ] **Step 4: Verify it compiles and imports**

Run (from `services/dev-providers`):
```
python3 -m py_compile dev_providers/main.py dev_providers/yfinance_provider.py dev_providers/yfinance_fundamentals.py
python3 -c "import dev_providers.yfinance_provider"
python3 -m unittest tests.test_yfinance_provider
```
Expected: no compile errors; the provider module imports cleanly; 13 tests still PASS.
(`import dev_providers.main` is intentionally NOT run — it imports FastAPI, which isn't in the bare interpreter; `py_compile` covers its syntax.)

- [ ] **Step 5: Commit**

```bash
git add services/dev-providers/dev_providers/yfinance_provider.py services/dev-providers/dev_providers/main.py
git commit -m "feat(dev-providers): /fundamentals/consensus yfinance endpoint (fra-tcav)"
```

---

## Task 3: TS consensus repository (TDD)

**Files:**
- Modify: `services/fundamentals/src/dev-provider-fundamentals.ts`
- Test: `services/fundamentals/test/dev-providers.test.ts`

- [ ] **Step 1: Write the failing tests**

In `services/fundamentals/test/dev-providers.test.ts`, add `createDevProvidersConsensusRepository` to the existing import from `../src/dev-providers.ts`, then add these tests at the end of the file:

```ts
test("dev providers consensus repository maps a sidecar envelope onto the issuer", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const repo = createDevProvidersConsensusRepository({
    profiles: { async find() { return sparseProfile(); } },
    baseUrl: "http://dev-providers.test",
    sourceId: YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(
        JSON.stringify({
          status: "available",
          data: {
            as_of: "2026-06-04T12:00:00.000Z",
            currency: "USD",
            analyst_count: 41,
            rating_distribution: { strong_buy: 14, buy: 17, hold: 8, sell: 1, strong_sell: 1 },
            price_target: { low: 170, mean: 220.5, median: 215, high: 280 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const envelope = await repo.find(ISSUER_ID);
  assert.equal(envelope?.subject.id, ISSUER_ID);
  assert.equal(envelope?.analyst_count, 41);
  assert.equal(envelope?.rating_distribution?.counts.strong_buy, 14);
  assert.equal(envelope?.rating_distribution?.contributor_count, 41);
  assert.equal(envelope?.rating_distribution?.source_id, YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID);
  assert.equal(envelope?.price_target?.high, 280);
  assert.equal(envelope?.price_target?.currency, "USD");
  assert.equal(calls[0].url, "http://dev-providers.test/fundamentals/consensus");
  assert.deepEqual(calls[0].body, {
    ticker: "AMD",
    mic: "XNAS",
    currency: "USD",
    timezone: "America/New_York",
  });
});

test("dev providers consensus repository keeps a price target when ratings are absent", async () => {
  const repo = createDevProvidersConsensusRepository({
    profiles: { async find() { return sparseProfile(); } },
    baseUrl: "http://dev-providers.test",
    sourceId: YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          status: "available",
          data: {
            as_of: "2026-06-04T12:00:00.000Z",
            currency: "USD",
            analyst_count: 5,
            rating_distribution: null,
            price_target: { low: 100, mean: 120, median: 118, high: 140 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });
  const envelope = await repo.find(ISSUER_ID);
  assert.equal(envelope?.rating_distribution, null);
  assert.equal(envelope?.price_target?.mean, 120);
});

test("dev providers consensus repository returns null when coverage is missing", async () => {
  const repo = createDevProvidersConsensusRepository({
    profiles: { async find() { return sparseProfile(); } },
    baseUrl: "http://dev-providers.test",
    sourceId: YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ status: "unavailable", reason: "missing_coverage", retryable: false, detail: "none" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });
  assert.equal(await repo.find(ISSUER_ID), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `services/fundamentals`):
```
node --experimental-strip-types --test test/dev-providers.test.ts
```
Expected: FAIL — `createDevProvidersConsensusRepository` is not exported.

- [ ] **Step 3: Implement the repository + mapper**

In `services/fundamentals/src/dev-provider-fundamentals.ts`:

Add imports at the top (after the existing `./holders.ts` import group):

```ts
import {
  buildAnalystConsensus,
  type AnalystRatingCounts,
  type BuildAnalystConsensusInput,
  type PriceTarget,
} from "./analyst-consensus.ts";
import type { ConsensusRepository } from "./consensus-repository.ts";
```

Add the options type next to `DevProvidersHoldersRepositoryOptions`:

```ts
export type DevProvidersConsensusRepositoryOptions = DevProvidersEarningsRepositoryOptions;
```

Add the repository factory (after `createDevProvidersHoldersRepository`):

```ts
export function createDevProvidersConsensusRepository(
  options: DevProvidersConsensusRepositoryOptions,
): ConsensusRepository {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_DEV_PROVIDER_TIMEOUT_MS;

  return {
    async find(issuer_id: UUID) {
      const context = await issuerSidecarContext(options.profiles, issuer_id);
      if (!context) return null;
      const envelope = await postSidecar({
        baseUrl: options.baseUrl,
        path: "/fundamentals/consensus",
        body: sidecarListingBody(context.listing),
        fetchImpl,
        timeoutMs,
      });
      if (envelope.status !== "available") {
        if (sidecarUnavailableReason(envelope) === "missing_coverage") return null;
        throw sidecarUnavailableError(envelope, "yfinance consensus");
      }
      const input = sidecarConsensusInput(
        envelope.data,
        issuer_id,
        context.listing.currency,
        options.sourceId,
      );
      try {
        return buildAnalystConsensus(input);
      } catch (error) {
        throw providerPayloadError("yfinance consensus", errorMessage(error));
      }
    },
  };
}

type SidecarConsensus = {
  as_of?: unknown;
  currency?: unknown;
  analyst_count?: unknown;
  rating_distribution?: unknown;
  price_target?: unknown;
};

function sidecarConsensusInput(
  value: unknown,
  issuerId: UUID,
  fallbackCurrency: string,
  sourceId: UUID,
): BuildAnalystConsensusInput {
  if (!isRecord(value)) throw providerPayloadError("yfinance consensus", "consensus payload");
  const data = value as SidecarConsensus;
  const asOf = stringValue(data.as_of);
  if (!asOf) throw providerPayloadError("yfinance consensus", "consensus payload");
  const currency = stringValue(data.currency) ?? fallbackCurrency;

  const ratingCounts = sidecarRatingCounts(data.rating_distribution);
  const ratingSum = ratingCounts
    ? ratingCounts.strong_buy + ratingCounts.buy + ratingCounts.hold + ratingCounts.sell + ratingCounts.strong_sell
    : 0;
  // The builder warns when contributor_count > analyst_count; take the max so a
  // rating sum that exceeds yfinance's analyst count stays consistent.
  const analystCount = Math.max(integerValue(data.analyst_count) ?? 0, ratingSum);
  const priceTarget = sidecarPriceTarget(data.price_target, currency, analystCount, asOf, sourceId);

  return {
    subject: { kind: "issuer", id: issuerId },
    analyst_count: analystCount,
    as_of: asOf,
    estimates: [],
    ...(ratingCounts
      ? {
          rating_distribution: {
            counts: ratingCounts,
            contributor_count: ratingSum,
            as_of: asOf,
            source_id: sourceId,
          },
        }
      : {}),
    ...(priceTarget ? { price_target: priceTarget } : {}),
  };
}

function sidecarRatingCounts(value: unknown): AnalystRatingCounts | null {
  if (!isRecord(value)) return null;
  const counts = {
    strong_buy: integerValue(value.strong_buy) ?? 0,
    buy: integerValue(value.buy) ?? 0,
    hold: integerValue(value.hold) ?? 0,
    sell: integerValue(value.sell) ?? 0,
    strong_sell: integerValue(value.strong_sell) ?? 0,
  };
  const total = counts.strong_buy + counts.buy + counts.hold + counts.sell + counts.strong_sell;
  return total > 0 ? counts : null;
}

function sidecarPriceTarget(
  value: unknown,
  currency: string,
  analystCount: number,
  asOf: string,
  sourceId: UUID,
): PriceTarget | null {
  if (!isRecord(value)) return null;
  const low = finiteNumber(value.low);
  const mean = finiteNumber(value.mean);
  const median = finiteNumber(value.median);
  const high = finiteNumber(value.high);
  if (low === null || mean === null || median === null || high === null) return null;
  // Omit on ordering violation so we never emit a visibly-inconsistent target.
  if (!(low <= mean && mean <= high && low <= median && median <= high)) return null;
  return {
    currency,
    low,
    mean,
    median,
    high,
    contributor_count: analystCount,
    as_of: asOf,
    source_id: sourceId,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `services/fundamentals`):
```
node --experimental-strip-types --test test/dev-providers.test.ts
```
Expected: PASS (existing tests + 3 new).

- [ ] **Step 5: Commit**

```bash
git add services/fundamentals/src/dev-provider-fundamentals.ts services/fundamentals/test/dev-providers.test.ts
git commit -m "feat(fundamentals): dev-provider consensus repository (fra-tcav)"
```

---

## Task 4: Wire consensus into the runtime + dev.ts

**Files:**
- Modify: `services/fundamentals/src/dev-providers.ts`
- Modify: `services/fundamentals/src/dev.ts`

- [ ] **Step 1: Add consensus to `DevProviderRuntime` + re-export the factory**

In `services/fundamentals/src/dev-providers.ts`:

Extend the import from `./dev-provider-fundamentals.ts`:
```ts
import {
  createDevProvidersConsensusRepository,
  createDevProvidersEarningsRepository,
  createDevProvidersHoldersRepository,
  type DevProvidersConsensusRepositoryOptions,
  type DevProvidersEarningsRepositoryOptions,
  type DevProvidersHoldersRepositoryOptions,
} from "./dev-provider-fundamentals.ts";
```

Add to the re-export block:
```ts
export {
  createDevProvidersConsensusRepository,
  createDevProvidersEarningsRepository,
  createDevProvidersHoldersRepository,
  createDevProvidersIssuerProfileRepository,
  type DevProvidersConsensusRepositoryOptions,
  type DevProvidersEarningsRepositoryOptions,
  type DevProvidersHoldersRepositoryOptions,
  type DevProvidersIssuerProfileRepositoryOptions,
  type IssuerProfileTransactionalQueryExecutor,
};
```

Add a `ConsensusRepository` import:
```ts
import type { ConsensusRepository } from "./consensus-repository.ts";
```

Add `consensus` to the runtime type:
```ts
export type DevProviderRuntime = {
  profiles: IssuerProfileRepository;
  earnings: EarningsRepository;
  holders: HoldersRepository;
  consensus: ConsensusRepository;
};
```

Construct it in `createDevProviderRuntime` (after `holders:`):
```ts
    holders: createDevProvidersHoldersRepository({
      profiles: options.profiles,
      sourceId: options.sourceId,
      ...sidecarOptions,
    }),
    consensus: createDevProvidersConsensusRepository({
      profiles: options.profiles,
      sourceId: options.sourceId,
      ...sidecarOptions,
    }),
```

- [ ] **Step 2: Wire it in `dev.ts`**

In `services/fundamentals/src/dev.ts`, replace:
```ts
const consensus = createUnsupportedConsensusRepository();
```
with:
```ts
const consensus = devProviderRuntime?.consensus ?? createUnsupportedConsensusRepository();
```

- [ ] **Step 3: Run the full fundamentals suite**

Run (from `services/fundamentals`):
```
node --experimental-strip-types --test 'test/**/*.test.ts'
```
Expected: PASS (all fundamentals tests, including the 3 new consensus tests). `dev.ts` is a side-effecting entry script (opens a Pool + listens) and is not imported by tests; its one-line change mirrors the existing `earnings`/`holders` wiring exactly.

- [ ] **Step 4: Commit**

```bash
git add services/fundamentals/src/dev-providers.ts services/fundamentals/src/dev.ts
git commit -m "feat(fundamentals): wire consensus dev-provider into runtime + dev.ts (fra-tcav)"
```

---

## Task 5: Final verification + close

- [ ] **Step 1: Run both suites**

Run:
```
cd services/dev-providers && python3 -m unittest tests.test_yfinance_provider
cd ../fundamentals && node --experimental-strip-types --test 'test/**/*.test.ts'
```
Expected: Python PASS (13 tests); fundamentals PASS.

- [ ] **Step 2: Close the bead**

```bash
bd close fra-tcav --reason="analyst consensus flows via yfinance dev-provider sidecar: /fundamentals/consensus endpoint + normalizer, createDevProvidersConsensusRepository, wired into runtime + dev.ts. ConsensusRepository returns real envelopes when ENABLE_UNOFFICIAL_DEV_PROVIDERS is on; gracefully null otherwise."
```

- [ ] **Step 3: Continue to `fra-6syg`**

Do NOT finish the branch yet — `fra-6syg` (analyst_consensus + price_target_range emitters, consuming this envelope) and `fra-q840` continue on the same `feat/analyst-consensus` branch per the requested sequence.

---

## Self-Review notes

- **Spec coverage:** sidecar endpoint + normalizer (Tasks 1-2) · TS repo + mapper discipline (Task 3) · wiring (Task 4) · TS fake-fetch + partial + unavailable tests (Task 3) · Python normalizer tests (Task 1) · empty-estimates reality (mapper sets `estimates: []`) · `analyst_count = max(...)` and omit-on-inconsistency (Task 3 mapper).
- **Correction vs spec:** consistency rules are warnings (not throws); the mapper discipline still applies for clean envelopes, and structural completeness (all 5 rating buckets, present sub-objects) is what avoids throws — captured in Background + Task 3.
- **Type consistency:** `normalize_analyst_consensus`, `sidecarConsensusInput`, `sidecarRatingCounts`, `sidecarPriceTarget`, `DevProvidersConsensusRepositoryOptions`, `ConsensusRepository`, `DevProviderRuntime.consensus` used identically across tasks.
- **Out of scope (fra-6syg):** metric_keys seed, materializer, block builders, snapshot helpers, playbook sections, web; `price_target_range` current price from the market service.
