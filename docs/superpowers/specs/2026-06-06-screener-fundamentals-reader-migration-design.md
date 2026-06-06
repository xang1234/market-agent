# Migrate screener `loadLatestFundamentals` onto `loadRecentIssuerFundamentals`

**Bead:** fra-rd6k (follow-up to fra-savt)
**Date:** 2026-06-06

## Problem

`services/screener/src/db-candidates.ts` has a private `loadLatestFundamentals` that
queries `facts` directly: it filters `period_kind='fiscal_y'` + `fiscal_period='FY'`
+ a fixed six-metric set, and uses a `latest_year` CTE that anchors on **revenue's**
maximum fiscal year, then pulls that year and the prior year.

It does **not** apply the entitlement-channel or verification-status filter. That is
the parity gap: the screener can surface fundamentals derived from facts that are not
display-verified or not entitled to the egress channel, while chat (which reads through
the canonical `loadRecentIssuerFundamentals`) correctly excludes them.

The eligibility rule for "which facts may ground a user-facing number" now lives in two
places with two different definitions. This migration collapses it to one.

## Goal

Route the screener through the canonical reader so the eligibility filter
(`method='reported'`, active, `entitlement_channels`, `verification_status`) lives in a
single place, while preserving the screener's existing observable behavior (same
current/prior buckets, same margins / growth math).

## Design

### 1. Canonical reader API (`services/fundamentals/src/issuer-fundamentals-reader.ts`)

Add two optional filters and make `limit` optional:

```ts
export type LoadRecentIssuerFundamentalsOptions = {
  // Egress channel the facts must be entitled to. Defaults to "app".
  channel?: FactEntitlementChannel;
  // Restrict to a single period kind (e.g. "fiscal_y" for annual). Omit ⇒ all kinds.
  periodKind?: PeriodKind;            // imported from ./statement.ts
  // Restrict to a metric-key set. Omit ⇒ all metrics.
  metricKeys?: ReadonlyArray<string>;
  // Row cap. Omit ⇒ no LIMIT clause (caller bounds the query another way).
  limit?: number;
};
```

Query is assembled dynamically so chat's existing call produces byte-identical SQL:

- Base params: `[issuer.id, channel, [...DISPLAYABLE_VERIFICATION_STATUSES]]` → `$1,$2,$3`.
- If `periodKind` set: push it, append `and f.period_kind = $N`.
- If `metricKeys` set: push `[...metricKeys]`, append `and m.metric_key = any($N::text[])`.
- If `limit` set: push it, append `limit $N`.

Ordering is unchanged: `fiscal_year desc nulls last, as_of desc, metric_key`.

**Executor type widening.** The reader currently accepts evidence's `QueryExecutor`,
whose `query` returns a full `pg.QueryResult<R>`. The reader only ever reads `.rows`, so
narrow the accepted type to a locally-defined minimal executor:

```ts
type IssuerFundamentalsQueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
};
```

Both a `pg.Pool` (chat) and the screener's narrower `ScreenerCandidateQueryExecutor`
satisfy this. This is a safe widening of accepted inputs — chat's call still type-checks,
and the screener call becomes type-clean instead of relying on the screener service
having no CI typecheck.

Chat (`services/chat/src/local-runtime-structured.ts`) is unaffected: it passes only
`{ channel: "app", limit }`, so its SQL is identical.

### 2. Screener rewrite (`services/screener/src/db-candidates.ts`)

Delete `loadLatestFundamentals` and its `latest_year` CTE. Add:

```ts
const SCREENER_FUNDAMENTAL_METRICS = [
  "revenue", "gross_profit", "operating_income",
  "net_income", "eps_diluted", "shares_outstanding_diluted",
] as const;
```

In `loadPostgresScreenerCandidates`, replace the per-issuer call:

```ts
const facts = await loadRecentIssuerFundamentals(
  db,
  { kind: "issuer", id: row.issuer_id },
  { channel: "app", periodKind: "fiscal_y", metricKeys: SCREENER_FUNDAMENTAL_METRICS },
); // no limit — period+metric filters bound it; superseded-collapse ⇒ ~1 row/metric/year
const { current, prior } = pickCurrentPriorFundamentals(facts);
```

`pickCurrentPriorFundamentals` does the **revenue-anchored** pick in JS (preserving exact
current behavior):

```ts
function pickCurrentPriorFundamentals(facts: ReadonlyArray<IssuerFundamentalFact>): {
  current: Record<string, number | null>;
  prior: Record<string, number | null>;
} {
  // current = latest fiscal year that has a revenue fact; prior = current - 1.
  let currentYear: number | null = null;
  for (const f of facts) {
    if (f.metric_key === "revenue" && f.fiscal_year !== null) {
      if (currentYear === null || f.fiscal_year > currentYear) currentYear = f.fiscal_year;
    }
  }
  const current = emptyFacts();
  const prior = emptyFacts();
  if (currentYear === null) return { current, prior };

  const priorYear = currentYear - 1;
  const seen = new Set<string>();
  for (const f of facts) {
    if (f.fiscal_year !== currentYear && f.fiscal_year !== priorYear) continue;
    if (!(f.metric_key in current)) continue; // ignore metrics outside the known set
    const key = `${f.fiscal_year}:${f.metric_key}`;
    if (seen.has(key)) continue;               // first write wins == newest as_of
    seen.add(key);
    (f.fiscal_year === currentYear ? current : prior)[f.metric_key] = f.value_num;
  }
  return { current, prior };
}
```

The reader returns rows ordered `fiscal_year desc, as_of desc`, so the first occurrence of
a `(year, metric)` pair is the newest `as_of` — matching the old `seen`-set dedup. The
`{current, prior}` shape is unchanged, so the candidate-assembly block (`market_cap`,
`pe_ratio`, `gross_margin`, `operating_margin`, `net_margin`, `revenue_growth_yoy`) is
untouched.

`value_num` arrives already coerced to `number | null` by the reader (`numericOrNull`),
replacing the old inline `Number(row.value_num)`.

### Net effect

The screener inherits the entitlement-channel + verification-status parity filter, and the
"which facts are eligible" SQL exists in exactly one place. Observable screener output is
unchanged except where the old path was incorrectly including non-entitled /
non-display-verified facts — which is the intended correction.

## Testing

- **fundamentals** — `test/issuer-fundamentals-reader.integration.test.ts` (docker-pg; the
  real SQL-contract gate). Add cases:
  - `periodKind: "fiscal_y"` excludes a seeded `fiscal_q` fact.
  - `metricKeys: [...]` excludes a seeded off-list metric.
  - omitted `limit` returns all eligible rows (no truncation).

  Parity (entitlement/verification) is already covered by the existing test.

- **screener** — `test/db-candidates.test.ts` (unit, fake db; stays a unit CI job, no
  docker). Update the `FakeCandidateDb` fundamentals branch (now matches `from facts f`,
  not `with latest_year as`) and add a test returning canned current+prior fact rows,
  asserting the computed `candidate.fundamentals` (margins, `revenue_growth_yoy`,
  `market_cap`, `pe_ratio`).

No CI workflow change: the screener test uses a fake db, and the reader's transitive
imports into `evidence` are either `import type` (erased by strip-types) or pure constant
modules, so no `pg` is pulled into the screener unit job.

## Decisions

- **Revenue-anchored current year** (vs. max-FY-over-any-metric): preserves today's
  behavior and avoids null-ing margins when a non-revenue metric leads revenue by a year.
- **Optional `limit`, screener omits it** (vs. a generous required row cap): the
  `period_kind='fiscal_y'` + six-metric filter plus superseded-collapse naturally bounds
  the result to roughly one row per metric per year, so no fragile row-cap tuning.
- **`"app"` channel** for the screener, mirroring chat (the screener feeds the app UI).

## Out of scope

- The per-issuer N+1 fundamentals query loop (left as-is).
- `fiscal_period='FY'`: `period_kind='fiscal_y'` already implies annual `FY`; the bead
  asks for a `periodKind` option only, so no separate `fiscalPeriod` filter is added.
