# Screener Fundamentals Reader Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route the screener's per-issuer fundamentals load through the canonical `loadRecentIssuerFundamentals`, so the entitlement-channel + verification-status eligibility filter lives in exactly one place.

**Architecture:** Add optional `periodKind` / `metricKeys` filters and make `limit` optional on the canonical fundamentals reader; widen its executor type to a minimal row-only shape. Then delete the screener's private `loadLatestFundamentals` (and its `latest_year` CTE), calling the reader instead and doing the revenue-anchored current/prior year pick in JS.

**Tech Stack:** Node `--experimental-strip-types` + `node:test`, Postgres (`pg`), docker-pg integration harness (`db/test/docker-pg.ts`).

---

## File Structure

- `services/fundamentals/src/issuer-fundamentals-reader.ts` — **Modify.** Add `periodKind` + `metricKeys` options, make `limit` optional, build the SQL dynamically, widen the executor param type.
- `services/fundamentals/test/issuer-fundamentals-reader.integration.test.ts` — **Modify.** Widen the `revenueFact` override surface; add three integration tests (periodKind, metricKeys, omitted-limit).
- `services/screener/src/db-candidates.ts` — **Modify.** Delete `loadLatestFundamentals` + its unused `FactRow` type; add `SCREENER_FUNDAMENTAL_METRICS` + `pickCurrentPriorFundamentals`; call the reader at the existing call site.
- `services/screener/test/db-candidates.test.ts` — **Modify.** Update the fake-db fundamentals branch (`with latest_year as` → `from facts f`); add a current/prior math test.

---

## Task 1: Add reader filter tests (failing)

**Files:**
- Test: `services/fundamentals/test/issuer-fundamentals-reader.integration.test.ts`

- [ ] **Step 1: Widen the `revenueFact` override surface**

The helper currently only allows overriding `fiscal_year | value_num | verification_status | entitlement_channels`. The new tests need to override `period_kind` and `fiscal_period`. Change the `overrides` parameter type at line 31:

```ts
function revenueFact(
  metricId: string,
  sourceId: string,
  overrides: Pick<
    FactInput,
    | "fiscal_year"
    | "value_num"
    | "verification_status"
    | "entitlement_channels"
    | "period_kind"
    | "fiscal_period"
  >,
): FactInput {
```

(The body is unchanged — `...overrides` already spreads whatever is passed.)

- [ ] **Step 2: Add a generic metric seeder**

Below `seedRevenueMetric` (after line 26), add a helper that seeds an arbitrary metric key (the `metricKeys` test needs a second metric):

```ts
async function seedMetric(
  client: Client,
  metricKey: string,
  displayName: string,
): Promise<string> {
  const { rows } = await client.query<{ metric_id: string }>(
    `insert into metrics (metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class)
     values ($1, $2, 'currency', 'sum', 'higher_is_better', 'gaap')
     returning metric_id::text as metric_id`,
    [metricKey, displayName],
  );
  return rows[0].metric_id;
}
```

- [ ] **Step 3: Add the three filter tests**

Append after the existing test (after line 82):

```ts
test(
  "loadRecentIssuerFundamentals periodKind filter keeps only the requested period kind",
  { skip: !dockerAvailable(), timeout: 120000 },
  async (t) => {
    const { databaseUrl } = await bootstrapDatabase(t, "fundamentals-period-kind");
    const client = await connectedClient(t, databaseUrl);
    const sourceId = await seedSource(client);
    const metricId = await seedRevenueMetric(client);

    await createFact(client, revenueFact(metricId, sourceId, { fiscal_year: 2024, value_num: 100, verification_status: "authoritative", entitlement_channels: ["app"] }));
    await createFact(client, revenueFact(metricId, sourceId, { fiscal_year: 2025, value_num: 999, verification_status: "authoritative", entitlement_channels: ["app"], period_kind: "fiscal_q", fiscal_period: "Q4" }));

    const annual = await loadRecentIssuerFundamentals(client, { kind: "issuer", id: ISSUER_ID }, { periodKind: "fiscal_y", limit: 50 });
    assert.deepEqual(
      annual.map((f) => f.value_num),
      [100],
      "the fiscal_q fact is excluded when periodKind is fiscal_y",
    );

    const unfiltered = await loadRecentIssuerFundamentals(client, { kind: "issuer", id: ISSUER_ID }, { limit: 50 });
    assert.equal(unfiltered.length, 2, "without periodKind both period kinds are returned");
  },
);

test(
  "loadRecentIssuerFundamentals metricKeys filter keeps only the requested metrics",
  { skip: !dockerAvailable(), timeout: 120000 },
  async (t) => {
    const { databaseUrl } = await bootstrapDatabase(t, "fundamentals-metric-keys");
    const client = await connectedClient(t, databaseUrl);
    const sourceId = await seedSource(client);
    const revenueId = await seedRevenueMetric(client);
    const grossProfitId = await seedMetric(client, "gross_profit", "Gross Profit");

    await createFact(client, revenueFact(revenueId, sourceId, { fiscal_year: 2024, value_num: 100, verification_status: "authoritative", entitlement_channels: ["app"] }));
    await createFact(client, revenueFact(grossProfitId, sourceId, { fiscal_year: 2024, value_num: 60, verification_status: "authoritative", entitlement_channels: ["app"] }));

    const revenueOnly = await loadRecentIssuerFundamentals(client, { kind: "issuer", id: ISSUER_ID }, { metricKeys: ["revenue"], limit: 50 });
    assert.deepEqual(
      revenueOnly.map((f) => f.metric_key),
      ["revenue"],
      "gross_profit is excluded when metricKeys is ['revenue']",
    );
  },
);

test(
  "loadRecentIssuerFundamentals returns all eligible rows when limit is omitted",
  { skip: !dockerAvailable(), timeout: 120000 },
  async (t) => {
    const { databaseUrl } = await bootstrapDatabase(t, "fundamentals-no-limit");
    const client = await connectedClient(t, databaseUrl);
    const sourceId = await seedSource(client);
    const metricId = await seedRevenueMetric(client);

    await createFact(client, revenueFact(metricId, sourceId, { fiscal_year: 2024, value_num: 100, verification_status: "authoritative", entitlement_channels: ["app"] }));
    await createFact(client, revenueFact(metricId, sourceId, { fiscal_year: 2023, value_num: 90, verification_status: "authoritative", entitlement_channels: ["app"] }));
    await createFact(client, revenueFact(metricId, sourceId, { fiscal_year: 2022, value_num: 80, verification_status: "authoritative", entitlement_channels: ["app"] }));

    const all = await loadRecentIssuerFundamentals(client, { kind: "issuer", id: ISSUER_ID }, {});
    assert.deepEqual(
      all.map((f) => f.value_num),
      [100, 90, 80],
      "all three eligible facts are returned, newest fiscal year first, with no limit",
    );
  },
);
```

- [ ] **Step 4: Run the new tests to verify they fail**

Run (requires Docker running):
```bash
cd services/fundamentals && npm test
```
Expected: the three new tests FAIL. `periodKind`/`metricKeys` options are not yet honored, so `annual` returns 2 rows (not `[100]`) and `revenueOnly` returns both metric keys; the omitted-limit test fails earlier with no `limit` clause support. (If Docker is unavailable they SKIP — start Docker before implementing.)

- [ ] **Step 5: Commit**

```bash
git add services/fundamentals/test/issuer-fundamentals-reader.integration.test.ts
git commit -m "test(fundamentals): periodKind/metricKeys/omitted-limit reader cases (fra-rd6k)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Implement reader filters + executor widening

**Files:**
- Modify: `services/fundamentals/src/issuer-fundamentals-reader.ts`

- [ ] **Step 1: Swap the executor import for a local minimal type**

Replace line 1 (`import type { QueryExecutor } from "../../evidence/src/types.ts";`) — remove it. Add a `PeriodKind` import and a local executor type. The top of the file becomes:

```ts
import { DISPLAYABLE_VERIFICATION_STATUSES } from "../../evidence/src/promotion-rules.ts";
import type { FactEntitlementChannel } from "../../evidence/src/fact-repo.ts";
import type { PeriodKind } from "./statement.ts";
import type { IssuerSubjectRef } from "./subject-ref.ts";

// The reader only reads `.rows`. A pg.Pool/Client and the screener's narrower
// ScreenerCandidateQueryExecutor both satisfy this minimal shape, so callers
// don't have to produce a full pg.QueryResult.
type IssuerFundamentalsQueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
};
```

- [ ] **Step 2: Extend the options type**

Replace `LoadRecentIssuerFundamentalsOptions` (lines 24-29) with:

```ts
export type LoadRecentIssuerFundamentalsOptions = {
  // Egress channel the facts must be entitled to. Defaults to "app" — the
  // channel chat answers render on.
  channel?: FactEntitlementChannel;
  // Restrict to a single period kind (e.g. "fiscal_y" for annual). Omit ⇒ all kinds.
  periodKind?: PeriodKind;
  // Restrict to a metric-key set. Omit ⇒ all metrics.
  metricKeys?: ReadonlyArray<string>;
  // Row cap. Omit ⇒ no LIMIT clause (the caller bounds the query another way,
  // e.g. the screener's periodKind + metricKeys filters).
  limit?: number;
};
```

- [ ] **Step 3: Build the query dynamically**

Replace the whole function body (lines 45-83) with:

```ts
export async function loadRecentIssuerFundamentals(
  db: IssuerFundamentalsQueryExecutor,
  issuer: IssuerSubjectRef,
  options: LoadRecentIssuerFundamentalsOptions,
): Promise<IssuerFundamentalFact[]> {
  const channel = options.channel ?? "app";
  const params: unknown[] = [issuer.id, channel, [...DISPLAYABLE_VERIFICATION_STATUSES]];

  let filters = "";
  if (options.periodKind !== undefined) {
    params.push(options.periodKind);
    filters += `\n        and f.period_kind = $${params.length}`;
  }
  if (options.metricKeys !== undefined) {
    params.push([...options.metricKeys]);
    filters += `\n        and m.metric_key = any($${params.length}::text[])`;
  }

  let limitClause = "";
  if (options.limit !== undefined) {
    params.push(options.limit);
    limitClause = `\n      limit $${params.length}`;
  }

  const { rows } = await db.query<FactRow>(
    // Eligibility filter — the one place chat + screener share. method='reported'
    // keeps derived/estimated out; entitlement_channels and verification_status
    // give parity with the egress guard (fact-repo.listFactsForEgress) and the
    // promotion rules (only promoted facts ground answers). periodKind/metricKeys
    // are optional narrowings used by the screener's annual fixed-metric path.
    `select f.fact_id::text as fact_id,
            m.metric_key,
            m.display_name,
            f.value_num,
            f.value_text,
            f.unit,
            f.currency,
            f.fiscal_year,
            f.fiscal_period,
            f.as_of,
            f.source_id::text as source_id
       from facts f
       join metrics m on m.metric_id = f.metric_id
      where f.subject_kind = 'issuer'
        and f.subject_id = $1::uuid
        and f.method = 'reported'
        and f.superseded_by is null
        and f.invalidated_at is null
        and f.entitlement_channels ? $2
        and f.verification_status = any($3::verification_status[])${filters}
      order by f.fiscal_year desc nulls last,
               f.as_of desc,
               m.metric_key${limitClause}`,
    params,
  );
  return rows.map(factFromRow);
}
```

(`factFromRow`, `numericOrNull`, `isoString` below are unchanged.)

- [ ] **Step 4: Run the fundamentals tests to verify they pass**

Run:
```bash
cd services/fundamentals && npm test
```
Expected: PASS — the three new tests plus the existing parity test all pass; `fail 0`.

- [ ] **Step 5: Verify chat (the other reader caller) is unaffected**

Run:
```bash
cd services/chat && npm test
```
Expected: PASS — chat passes only `{ channel: "app", limit }`, so its SQL is byte-identical and the executor widening only relaxes the accepted input type. `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add services/fundamentals/src/issuer-fundamentals-reader.ts
git commit -m "feat(fundamentals): optional periodKind/metricKeys/limit on issuer reader (fra-rd6k)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Add the screener current/prior math test (failing)

**Files:**
- Test: `services/screener/test/db-candidates.test.ts`

- [ ] **Step 1: Update the existing fake-db fundamentals branch**

In `FakeCandidateDb.query` the second branch (line 48) matches the old CTE text. Change it so it matches the new reader query and keep returning empty (this existing test does not assert fundamentals):

```ts
    if (text.includes("from facts f")) {
      return rows([]);
    }
```

- [ ] **Step 2: Add the current/prior math test**

Append at the end of the file (after the existing `rows` helper, after line 57):

```ts
test("Postgres screener candidate repository computes current/prior fundamentals", async () => {
  const db = new FakeFundamentalsDb();
  const repo = createPostgresCandidateRepository(db, () => new Date("2026-05-08T00:00:00.000Z"));

  const candidates = await repo.list();
  const f = candidates[0]?.fundamentals;

  assert.ok(f, "a candidate is produced");
  assert.equal(f.market_cap, 120, "shares_outstanding_diluted(10) * price(12)");
  assert.equal(f.pe_ratio, 6, "price(12) / eps_diluted(2)");
  assert.equal(f.gross_margin, 0.4, "gross_profit(40) / revenue(100)");
  assert.equal(f.operating_margin, 0.3, "operating_income(30) / revenue(100)");
  assert.equal(f.net_margin, 0.2, "net_income(20) / revenue(100)");
  assert.equal(f.revenue_growth_yoy, 0.25, "(revenue 100 - prior 80) / prior 80");
});

class FakeFundamentalsDb {
  async query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
  ): Promise<{ rows: R[] }> {
    if (text.includes("from listings l")) {
      return rows([
        {
          issuer_id: "11111111-1111-4111-8111-111111111111",
          listing_id: "22222222-2222-4222-8222-222222222222",
          legal_name: "Provider Co",
          share_class: null,
          asset_type: "common_stock",
          mic: "XNAS",
          ticker: "PROV",
          trading_currency: "USD",
          domicile: "US",
          sector: "Technology",
          industry: "Software",
          price: 12,
          prev_close: 8,
          delay_class: "delayed",
          currency: "USD",
          as_of: "2026-05-08T00:00:00.000Z",
        },
      ] as R[]);
    }
    if (text.includes("from facts f")) {
      // Reader returns rows ordered fiscal_year desc, as_of desc, metric_key.
      return rows(
        [
          fact("revenue", 2024, 100),
          fact("gross_profit", 2024, 40),
          fact("operating_income", 2024, 30),
          fact("net_income", 2024, 20),
          fact("eps_diluted", 2024, 2),
          fact("shares_outstanding_diluted", 2024, 10),
          fact("revenue", 2023, 80),
        ] as R[],
      );
    }
    throw new Error(`unhandled query: ${text}`);
  }
}

function fact(metric_key: string, fiscal_year: number, value_num: number) {
  return {
    fact_id: `f-${metric_key}-${fiscal_year}`,
    metric_key,
    display_name: metric_key,
    value_num,
    value_text: null,
    unit: "currency",
    currency: "USD",
    fiscal_year,
    fiscal_period: "FY",
    as_of: "2026-05-08T00:00:00.000Z",
    source_id: "33333333-3333-4333-8333-333333333333",
  };
}
```

- [ ] **Step 3: Run the screener test to verify it fails**

Run:
```bash
cd services/screener && npm test
```
Expected: the new test FAILS. The production code still calls the old `loadLatestFundamentals`, which issues a `with latest_year as` query — `FakeFundamentalsDb` has no branch for that text and throws `unhandled query`, so `repo.list()` rejects.

- [ ] **Step 4: Commit**

```bash
git add services/screener/test/db-candidates.test.ts
git commit -m "test(screener): current/prior fundamentals via canonical reader (fra-rd6k)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Rewrite the screener onto the canonical reader

**Files:**
- Modify: `services/screener/src/db-candidates.ts`

- [ ] **Step 1: Import the reader and add the metric-set constant**

At the top of the file, after the existing imports (after line 6), add:

```ts
import { loadRecentIssuerFundamentals } from "../../fundamentals/src/issuer-fundamentals-reader.ts";
import type { IssuerFundamentalFact } from "../../fundamentals/src/issuer-fundamentals-reader.ts";

// The six annual reported metrics the screener derives ratios from. Kept in sync
// with emptyFacts() below.
const SCREENER_FUNDAMENTAL_METRICS = [
  "revenue",
  "gross_profit",
  "operating_income",
  "net_income",
  "eps_diluted",
  "shares_outstanding_diluted",
] as const;
```

- [ ] **Step 2: Delete the now-unused `FactRow` type**

Remove the `FactRow` type declaration (lines 51-55) — it was only used by `loadLatestFundamentals`, which this task deletes.

- [ ] **Step 3: Call the reader at the per-issuer call site**

Replace line 103 (`const facts = await loadLatestFundamentals(db, row.issuer_id);`) with:

```ts
    const facts = pickCurrentPriorFundamentals(
      await loadRecentIssuerFundamentals(
        db,
        { kind: "issuer", id: row.issuer_id },
        {
          channel: "app",
          periodKind: "fiscal_y",
          metricKeys: SCREENER_FUNDAMENTAL_METRICS,
        },
      ),
    );
```

Lines 104-105 (`const latest = facts.current;` / `const prior = facts.prior;`) and everything downstream stay exactly as-is — `facts` keeps the `{ current, prior }` shape.

- [ ] **Step 4: Replace `loadLatestFundamentals` with the JS pick**

Delete the entire `loadLatestFundamentals` function (lines 160-226) and put `pickCurrentPriorFundamentals` in its place:

```ts
function pickCurrentPriorFundamentals(facts: ReadonlyArray<IssuerFundamentalFact>): {
  current: Record<string, number | null>;
  prior: Record<string, number | null>;
} {
  // Revenue-anchored: current = latest fiscal year that has a revenue fact;
  // prior = current - 1. Keeps margins' numerator and denominator in the same
  // year and matches the pre-migration latest_year CTE behavior.
  let currentYear: number | null = null;
  for (const fact of facts) {
    if (fact.metric_key === "revenue" && fact.fiscal_year !== null) {
      if (currentYear === null || fact.fiscal_year > currentYear) {
        currentYear = fact.fiscal_year;
      }
    }
  }

  const current = emptyFacts();
  const prior = emptyFacts();
  if (currentYear === null) return { current, prior };

  const priorYear = currentYear - 1;
  const seen = new Set<string>();
  for (const fact of facts) {
    if (fact.fiscal_year !== currentYear && fact.fiscal_year !== priorYear) continue;
    if (!(fact.metric_key in current)) continue; // ignore metrics outside the set
    const key = `${fact.fiscal_year}:${fact.metric_key}`;
    if (seen.has(key)) continue; // reader orders as_of desc ⇒ first write is newest
    seen.add(key);
    (fact.fiscal_year === currentYear ? current : prior)[fact.metric_key] = fact.value_num;
  }

  return { current, prior };
}
```

(`emptyFacts`, `ratio`, `isoString` below are unchanged.)

- [ ] **Step 5: Run the screener tests to verify they pass**

Run:
```bash
cd services/screener && npm test
```
Expected: PASS — the new current/prior math test and the existing reload test both pass; `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add services/screener/src/db-candidates.ts
git commit -m "refactor(screener): load fundamentals via canonical reader, drop direct facts query (fra-rd6k)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Full verification, close bead, push

- [ ] **Step 1: Re-run both affected service suites**

```bash
cd services/fundamentals && npm test
cd ../screener && npm test
cd ../chat && npm test
```
Expected: all three report `fail 0`.

- [ ] **Step 2: Confirm `loadLatestFundamentals` is fully gone**

```bash
grep -rn "loadLatestFundamentals\|latest_year as" services/screener/
```
Expected: no matches.

- [ ] **Step 3: Close the bead and push**

```bash
bd close fra-rd6k --reason="Screener loadLatestFundamentals migrated onto loadRecentIssuerFundamentals; entitlement/verification parity now lives in one place"
git push
```
Expected: push succeeds; CI runs the fundamentals (integration) and screener (unit) jobs green.

---

## Notes for the implementer

- **Docker required for Task 1/2:** the fundamentals tests use the docker-pg harness and SKIP (not fail) when Docker is down. Start Docker before implementing so the red→green transition is real.
- **Why the screener test stays unit-only:** it uses a fake db; the reader's transitive `evidence` imports are either `import type` (erased by strip-types) or pure constant modules (`promotion-rules`), so no `pg` is pulled into the screener CI job. Do not convert the screener CI job to an integration job.
- **`fiscal_period='FY'` intentionally dropped:** `period_kind='fiscal_y'` already implies annual `FY` in valid data (`analyst-consensus.ts:404` validates exactly that), and the bead asks for a `periodKind` option only.
