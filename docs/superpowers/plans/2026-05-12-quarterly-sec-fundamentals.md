# Quarterly SEC Fundamentals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve and display discrete quarterly income-statement fundamentals from SEC EDGAR `companyfacts` without confusing quarter values with six-month or nine-month year-to-date facts.

**Architecture:** Keep SEC ingestion inside `services/fundamentals` and continue persisting statement lines into the existing `facts` table. Add a small SEC concept-value selector that ranks annual and quarterly XBRL contexts explicitly, then reuse the existing `POST /v1/fundamentals/statements` period contract (`YYYY-Q1` through `YYYY-Q4`) for backend and UI reads.

**Tech Stack:** TypeScript, Node `node:test`, React, Vite, PostgreSQL-backed `facts`, SEC `data.sec.gov/api/xbrl/companyfacts`.

---

## File Structure

- Modify `services/fundamentals/src/sec-edgar.ts`
  - Add exported concept-value selection helpers.
  - Make `extractStatement` use those helpers instead of `values.find(...)`.
  - Preserve annual behavior while making quarterly flow selection discrete-quarter-only.
- Modify `services/fundamentals/test/sec-edgar.test.ts`
  - Add tests for quarterly value selection, including a mixed 3-month plus YTD companyfacts fixture.
- Modify `services/fundamentals/test/sec-facts-repository.test.ts`
  - Add a repository test proving `2024-Q2` persists as `period_kind = "fiscal_q"` and reads back from `facts`.
- Modify `services/fundamentals/src/dev-statement-fixtures.ts`
  - Add Apple FY2024 quarterly income-statement fixtures for local UI and HTTP contract tests.
- Modify `services/fundamentals/test/statements.http.test.ts`
  - Add a contract test for `POST /v1/fundamentals/statements` with quarterly periods.
- Modify `web/src/symbol/statements.ts`
  - Add `recentFiscalQuarterPeriods(...)`.
- Modify `web/src/symbol/statements.test.ts`
  - Add period helper tests for fiscal quarter rollover.
- Modify `web/src/pages/symbol/FinancialsSection.tsx`
  - Add an annual/quarterly period toggle and request quarterly periods when selected.
- Modify or add `web/src/pages/symbol/FinancialsSection.test.tsx` if there is already a symbol-section render harness. If no focused harness exists, add assertions to the nearest existing page/surface test that already renders financials.

---

### Task 1: Add SEC Quarterly Concept Selection

**Files:**
- Modify: `services/fundamentals/src/sec-edgar.ts`
- Test: `services/fundamentals/test/sec-edgar.test.ts`

- [ ] **Step 1: Write failing selector tests**

Add this test block to `services/fundamentals/test/sec-edgar.test.ts` after the existing extraction tests:

```ts
test("quarterly companyfacts extraction prefers discrete quarter values over YTD values", () => {
  const q2Accn = "0000320193-24-000069";
  const facts = aaplCompanyFactsFixture();
  const usGaap = facts.facts["us-gaap"]!;
  const q2Discrete = {
    fy: 2024,
    fp: "Q2",
    form: "10-Q",
    accn: q2Accn,
    filed: "2024-05-03",
    start: "2023-12-31",
    end: "2024-03-30",
    frame: "CY2024Q1",
  };
  const q2Ytd = {
    fy: 2024,
    fp: "Q2",
    form: "10-Q",
    accn: q2Accn,
    filed: "2024-05-03",
    start: "2023-10-01",
    end: "2024-03-30",
  };

  usGaap.RevenueFromContractWithCustomerExcludingAssessedTax.units.USD = [
    value({ val: 210_328_000_000, ...q2Ytd }),
    value({ val: 90_753_000_000, ...q2Discrete }),
  ];
  usGaap.CostOfGoodsAndServicesSold.units.USD = [
    value({ val: 112_258_000_000, ...q2Ytd }),
    value({ val: 48_482_000_000, ...q2Discrete }),
  ];
  usGaap.GrossProfit.units.USD = [
    value({ val: 98_070_000_000, ...q2Ytd }),
    value({ val: 42_271_000_000, ...q2Discrete }),
  ];
  usGaap.OperatingIncomeLoss.units.USD = [
    value({ val: 70_898_000_000, ...q2Ytd }),
    value({ val: 27_900_000_000, ...q2Discrete }),
  ];
  usGaap.NetIncomeLoss.units.USD = [
    value({ val: 57_552_000_000, ...q2Ytd }),
    value({ val: 23_636_000_000, ...q2Discrete }),
  ];
  usGaap.EarningsPerShareBasic.units["USD/shares"] = [
    value({ val: 3.71, ...q2Ytd }),
    value({ val: 1.53, ...q2Discrete }),
  ];
  usGaap.EarningsPerShareDiluted.units["USD/shares"] = [
    value({ val: 3.71, ...q2Ytd }),
    value({ val: 1.53, ...q2Discrete }),
  ];
  usGaap.WeightedAverageNumberOfSharesOutstandingBasic.units.shares = [
    value({ val: 15_509_763_000, ...q2Discrete }),
  ];
  usGaap.WeightedAverageNumberOfDilutedSharesOutstanding.units.shares = [
    value({ val: 15_464_709_000, ...q2Discrete }),
  ];

  const statement = normalizedStatement(extractStatement({
    subject: aaplIssuer,
    facts,
    family: "income",
    fiscal_year: 2024,
    fiscal_period: "Q2",
    accession_number: q2Accn,
    source_id: SEC_SOURCE_ID,
    as_of: "2024-05-03T20:30:00.000Z",
  }));

  assert.equal(statement.period_kind, "fiscal_q");
  assert.equal(statement.period_start, "2023-12-31");
  assert.equal(statement.period_end, "2024-03-30");
  assert.equal(statement.lines.find((line) => line.metric_key === "revenue")?.value_num, 90_753_000_000);
  assert.equal(statement.lines.find((line) => line.metric_key === "net_income")?.value_num, 23_636_000_000);
});

test("quarterly companyfacts extraction does not use six-month YTD values as a discrete quarter", () => {
  const q2Accn = "0000320193-24-000069";
  const facts = aaplCompanyFactsFixture();
  const usGaap = facts.facts["us-gaap"]!;
  const q2Ytd = {
    fy: 2024,
    fp: "Q2",
    form: "10-Q",
    accn: q2Accn,
    filed: "2024-05-03",
    start: "2023-10-01",
    end: "2024-03-30",
  };

  usGaap.RevenueFromContractWithCustomerExcludingAssessedTax.units.USD = [
    value({ val: 210_328_000_000, ...q2Ytd }),
  ];

  assert.throws(
    () => extractStatement({
      subject: aaplIssuer,
      facts,
      family: "income",
      fiscal_year: 2024,
      fiscal_period: "Q2",
      accession_number: q2Accn,
      source_id: SEC_SOURCE_ID,
      as_of: "2024-05-03T20:30:00.000Z",
    }),
    /no us-gaap values/,
  );
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
cd services/fundamentals
npm test -- test/sec-edgar.test.ts
```

Expected: the first new test fails because extraction returns the YTD revenue value; the second fails because extraction accepts the YTD-only value.

- [ ] **Step 3: Add the SEC value selector**

In `services/fundamentals/src/sec-edgar.ts`, replace the inline `values.find(...)` in `extractStatement` with `selectConceptValue(...)`, and add these helpers near the extraction section:

```ts
type SelectConceptValueInput = {
  values: ReadonlyArray<SecConceptValue>;
  fiscal_year: number;
  fiscal_period: FiscalPeriod;
  expected_form: string;
  accession_number?: string;
};

function selectConceptValue(input: SelectConceptValueInput): SecConceptValue | null {
  const matches = input.values.filter(
    (v) =>
      v.fy === input.fiscal_year &&
      v.fp === input.fiscal_period &&
      v.form === input.expected_form &&
      (input.accession_number === undefined || v.accn === input.accession_number),
  );
  if (matches.length === 0) return null;
  if (input.fiscal_period === "FY") {
    return matches[0] ?? null;
  }

  const quarterMatches = matches
    .filter(isDiscreteQuarterDuration)
    .sort(compareQuarterFactQuality);
  return quarterMatches[0] ?? null;
}

function isDiscreteQuarterDuration(value: SecConceptValue): boolean {
  if (value.start === undefined) return false;
  const days = inclusiveDurationDays(value.start, value.end);
  return days >= 60 && days <= 125;
}

function compareQuarterFactQuality(a: SecConceptValue, b: SecConceptValue): number {
  return quarterFactScore(b) - quarterFactScore(a) || b.filed.localeCompare(a.filed);
}

function quarterFactScore(value: SecConceptValue): number {
  let score = 0;
  if (value.frame && /^CY\d{4}Q[1-4]$/.test(value.frame)) score += 2;
  if (value.start !== undefined && inclusiveDurationDays(value.start, value.end) >= 80) score += 1;
  return score;
}

function inclusiveDurationDays(start: string, end: string): number {
  const startMs = Date.parse(`${start}T00:00:00.000Z`);
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return 0;
  }
  return Math.floor((endMs - startMs) / 86_400_000) + 1;
}
```

Then change the match call inside `extractStatement`:

```ts
const match = selectConceptValue({
  values,
  fiscal_year: input.fiscal_year,
  fiscal_period: input.fiscal_period,
  expected_form: expectedForm,
  accession_number: input.accession_number,
});
```

- [ ] **Step 4: Run the SEC extraction tests**

Run:

```bash
cd services/fundamentals
npm test -- test/sec-edgar.test.ts
```

Expected: all tests in `test/sec-edgar.test.ts` pass.

- [ ] **Step 5: Commit**

```bash
git add services/fundamentals/src/sec-edgar.ts services/fundamentals/test/sec-edgar.test.ts
git commit -m "feat: select discrete SEC quarter facts"
```

---

### Task 2: Prove SEC-Backed Quarterly Persistence

**Files:**
- Modify: `services/fundamentals/test/sec-facts-repository.test.ts`

- [ ] **Step 1: Write the failing repository test**

Add this test after `"SEC-backed statements persist companyfacts and repeat reads from facts"`:

```ts
test("SEC-backed statements persist quarterly companyfacts as fiscal_q facts", async () => {
  const db = new FakeFundamentalsDb();
  let fetchCount = 0;
  const statements = createSecBackedStatementRepository(db, {
    fetcher: async () => {
      fetchCount += 1;
      return quarterlyCompanyFacts();
    },
    sourceId: SOURCE_ID,
    clock: () => new Date("2026-05-08T00:00:00.000Z"),
  });

  const first = await statements.find({
    issuer_id: ISSUER_ID,
    family: "income",
    basis: "as_reported",
    fiscal_year: 2024,
    fiscal_period: "Q2",
  });

  assert.equal(first?.period_kind, "fiscal_q");
  assert.equal(first?.period_start, "2023-12-31");
  assert.equal(first?.period_end, "2024-03-30");
  assert.equal(first?.lines.find((line) => line.metric_key === "revenue")?.value_num, 90_753_000_000);
  assert.equal(db.facts.every((fact) => fact.period_kind === "fiscal_q"), true);
  assert.equal(db.facts.every((fact) => fact.fiscal_period === "Q2"), true);

  const factCount = db.facts.length;
  const second = await statements.find({
    issuer_id: ISSUER_ID,
    family: "income",
    basis: "as_reported",
    fiscal_year: 2024,
    fiscal_period: "Q2",
  });

  assert.equal(second?.lines.find((line) => line.metric_key === "revenue")?.value_num, 90_753_000_000);
  assert.equal(db.facts.length, factCount);
  assert.equal(fetchCount, 1);
});
```

Add this fixture near the existing `companyFacts()` helpers:

```ts
function quarterlyCompanyFacts() {
  const facts = companyFacts();
  const q2Accn = "0000320193-24-000069";
  const q2Discrete = {
    start: "2023-12-31",
    end: "2024-03-30",
    accn: q2Accn,
    fy: 2024,
    fp: "Q2",
    form: "10-Q",
    filed: "2024-05-03",
    frame: "CY2024Q1",
  };
  const q2Ytd = {
    start: "2023-10-01",
    end: "2024-03-30",
    accn: q2Accn,
    fy: 2024,
    fp: "Q2",
    form: "10-Q",
    filed: "2024-05-03",
  };
  const usGaap = facts.facts["us-gaap"];

  usGaap.RevenueFromContractWithCustomerExcludingAssessedTax.units.USD = [
    { ...q2Ytd, val: 210_328_000_000 },
    { ...q2Discrete, val: 90_753_000_000 },
  ];
  usGaap.CostOfRevenue.units.USD = [
    { ...q2Ytd, val: 112_258_000_000 },
    { ...q2Discrete, val: 48_482_000_000 },
  ];
  usGaap.GrossProfit.units.USD = [
    { ...q2Ytd, val: 98_070_000_000 },
    { ...q2Discrete, val: 42_271_000_000 },
  ];
  usGaap.OperatingIncomeLoss.units.USD = [
    { ...q2Ytd, val: 70_898_000_000 },
    { ...q2Discrete, val: 27_900_000_000 },
  ];
  usGaap.NetIncomeLoss.units.USD = [
    { ...q2Ytd, val: 57_552_000_000 },
    { ...q2Discrete, val: 23_636_000_000 },
  ];
  usGaap.EarningsPerShareBasic.units["USD/shares"] = [
    { ...q2Ytd, val: 3.71 },
    { ...q2Discrete, val: 1.53 },
  ];
  usGaap.EarningsPerShareDiluted.units["USD/shares"] = [
    { ...q2Ytd, val: 3.71 },
    { ...q2Discrete, val: 1.53 },
  ];
  usGaap.WeightedAverageNumberOfSharesOutstandingBasic.units.shares = [
    { ...q2Discrete, val: 15_509_763_000 },
  ];
  usGaap.WeightedAverageNumberOfDilutedSharesOutstanding.units.shares = [
    { ...q2Discrete, val: 15_464_709_000 },
  ];
  return facts;
}
```

- [ ] **Step 2: Run the repository test**

Run:

```bash
cd services/fundamentals
npm test -- test/sec-facts-repository.test.ts
```

Expected: the new test passes after Task 1. If it fails because the fake DB does not mirror `period_kind = fiscal_q`, fix the fake query filter instead of changing production behavior.

- [ ] **Step 3: Commit**

```bash
git add services/fundamentals/test/sec-facts-repository.test.ts
git commit -m "test: cover SEC quarterly fact persistence"
```

---

### Task 3: Add Quarterly Dev Fixtures and HTTP Contract Coverage

**Files:**
- Modify: `services/fundamentals/src/dev-statement-fixtures.ts`
- Modify: `services/fundamentals/test/statements.http.test.ts`

- [ ] **Step 1: Add quarterly fixture support**

In `services/fundamentals/src/dev-statement-fixtures.ts`, replace the annual-only `PeriodLines` and `appleIncomeStatement` shape with this period-aware version:

```ts
type PeriodLines = {
  fiscal_year: number;
  fiscal_period: "FY" | "Q1" | "Q2" | "Q3" | "Q4";
  period_kind: "fiscal_y" | "fiscal_q";
  period_start: string;
  period_end: string;
  reported_at: string;
  revenue: number;
  cost_of_revenue: number;
  gross_profit: number;
  operating_expenses: number;
  operating_income: number;
  net_income: number;
  eps_basic: number;
  eps_diluted: number;
};

function appleIncomeStatement(p: PeriodLines): NormalizedStatementInput {
  return {
    subject: APPLE_ISSUER,
    family: "income",
    basis: "as_reported",
    period_kind: p.period_kind,
    period_start: p.period_start,
    period_end: p.period_end,
    fiscal_year: p.fiscal_year,
    fiscal_period: p.fiscal_period,
    reporting_currency: "USD",
    as_of: `${p.reported_at}T20:30:00.000Z`,
    reported_at: `${p.reported_at}T20:30:00.000Z`,
    source_id: DEV_STATEMENT_FIXTURE_SOURCE_ID,
    lines: [
      moneyLine("revenue", p.revenue),
      moneyLine("cost_of_revenue", p.cost_of_revenue),
      moneyLine("gross_profit", p.gross_profit),
      moneyLine("operating_expenses", p.operating_expenses),
      moneyLine("operating_income", p.operating_income),
      moneyLine("net_income", p.net_income),
      epsLine("eps_basic", p.eps_basic),
      epsLine("eps_diluted", p.eps_diluted),
    ],
  };
}
```

Update every object in `APPLE_INCOME_PERIODS` to include:

```ts
fiscal_period: "FY",
period_kind: "fiscal_y",
```

Add a quarterly fixture array:

```ts
const APPLE_INCOME_QUARTERS_FY2024: ReadonlyArray<PeriodLines> = [
  {
    fiscal_year: 2024,
    fiscal_period: "Q1",
    period_kind: "fiscal_q",
    period_start: "2023-10-01",
    period_end: "2023-12-30",
    reported_at: "2024-02-02",
    revenue: 119_575_000_000,
    cost_of_revenue: 64_720_000_000,
    gross_profit: 54_855_000_000,
    operating_expenses: 14_482_000_000,
    operating_income: 40_373_000_000,
    net_income: 33_916_000_000,
    eps_basic: 2.19,
    eps_diluted: 2.18,
  },
  {
    fiscal_year: 2024,
    fiscal_period: "Q2",
    period_kind: "fiscal_q",
    period_start: "2023-12-31",
    period_end: "2024-03-30",
    reported_at: "2024-05-03",
    revenue: 90_753_000_000,
    cost_of_revenue: 48_482_000_000,
    gross_profit: 42_271_000_000,
    operating_expenses: 14_371_000_000,
    operating_income: 27_900_000_000,
    net_income: 23_636_000_000,
    eps_basic: 1.53,
    eps_diluted: 1.53,
  },
  {
    fiscal_year: 2024,
    fiscal_period: "Q3",
    period_kind: "fiscal_q",
    period_start: "2024-03-31",
    period_end: "2024-06-29",
    reported_at: "2024-08-02",
    revenue: 85_777_000_000,
    cost_of_revenue: 46_099_000_000,
    gross_profit: 39_678_000_000,
    operating_expenses: 14_326_000_000,
    operating_income: 25_352_000_000,
    net_income: 21_448_000_000,
    eps_basic: 1.40,
    eps_diluted: 1.40,
  },
  {
    fiscal_year: 2024,
    fiscal_period: "Q4",
    period_kind: "fiscal_q",
    period_start: "2024-06-30",
    period_end: "2024-09-28",
    reported_at: "2024-11-01",
    revenue: 94_930_000_000,
    cost_of_revenue: 51_051_000_000,
    gross_profit: 43_879_000_000,
    operating_expenses: 14_288_000_000,
    operating_income: 29_591_000_000,
    net_income: 14_736_000_000,
    eps_basic: 0.98,
    eps_diluted: 0.97,
  },
];
```

Include them in `DEV_STATEMENTS`:

```ts
export const DEV_STATEMENTS: ReadonlyArray<StatementRepositoryRecord> = [
  ...APPLE_INCOME_PERIODS.map((p) => ({
    issuer_id: APPLE_ISSUER.id,
    basis: "as_reported" as const,
    statement: appleIncomeStatement(p),
  })),
  ...APPLE_INCOME_QUARTERS_FY2024.map((p) => ({
    issuer_id: APPLE_ISSUER.id,
    basis: "as_reported" as const,
    statement: appleIncomeStatement(p),
  })),
  {
    issuer_id: APPLE_ISSUER.id,
    basis: "as_restated" as const,
    statement: APPLE_INCOME_FY2020_RESTATED,
  },
];
```

- [ ] **Step 2: Add the HTTP contract test**

In `services/fundamentals/test/statements.http.test.ts`, add:

```ts
test("POST /v1/fundamentals/statements returns quarterly statement periods", async (t) => {
  const url = await startServer(t, buildDeps());
  const request = appleIncomeRequest(["2024-Q4", "2024-Q3", "2024-Q2", "2024-Q1"]);
  const res = await postStatements(url, request);

  assert.equal(res.status, 200);
  const body = (await res.json()) as GetStatementsResponse;

  assert.deepEqual(body.query, request);
  assert.equal(body.results.length, 4);

  for (const entry of body.results) {
    assert.equal(entry.outcome.outcome, "available");
    if (entry.outcome.outcome !== "available") return;
    assert.equal(entry.outcome.data.period_kind, "fiscal_q");
    assert.match(entry.outcome.data.fiscal_period, /^Q[1-4]$/);
  }

  const q2 = body.results.find((entry) => entry.period === "2024-Q2")?.outcome;
  assert.ok(q2 && q2.outcome === "available");
  if (q2.outcome !== "available") return;
  const revenue = q2.data.lines.find((line) => line.metric_key === "revenue");
  assert.equal(revenue?.value_num, 90_753_000_000);
});
```

- [ ] **Step 3: Run the fundamentals HTTP tests**

Run:

```bash
cd services/fundamentals
npm test -- test/statements.http.test.ts
```

Expected: the new quarterly contract test passes.

- [ ] **Step 4: Commit**

```bash
git add services/fundamentals/src/dev-statement-fixtures.ts services/fundamentals/test/statements.http.test.ts
git commit -m "feat: add quarterly fundamentals fixtures"
```

---

### Task 4: Add Frontend Quarter Period Helpers

**Files:**
- Modify: `web/src/symbol/statements.ts`
- Modify: `web/src/symbol/statements.test.ts`

- [ ] **Step 1: Write failing period-helper tests**

Add to `web/src/symbol/statements.test.ts`:

```ts
test('recentFiscalQuarterPeriods returns N most-recent fiscal quarter strings, newest first', () => {
  assert.deepEqual(recentFiscalQuarterPeriods(2024, 'Q4', 4), ['2024-Q4', '2024-Q3', '2024-Q2', '2024-Q1'])
  assert.deepEqual(recentFiscalQuarterPeriods(2024, 'Q2', 4), ['2024-Q2', '2024-Q1', '2023-Q4', '2023-Q3'])
  assert.deepEqual(recentFiscalQuarterPeriods(2024, 'Q1', 1), ['2024-Q1'])
  assert.deepEqual(recentFiscalQuarterPeriods(2024, 'Q4', 0), [])
})
```

Update the import list in that file to include `recentFiscalQuarterPeriods`.

- [ ] **Step 2: Run the failing frontend unit test**

Run:

```bash
cd web
npm test -- src/symbol/statements.test.ts
```

Expected: the test fails because `recentFiscalQuarterPeriods` is not exported.

- [ ] **Step 3: Implement the helper**

Add this export to `web/src/symbol/statements.ts` after `recentFyPeriods`:

```ts
export function recentFiscalQuarterPeriods(
  latestFiscalYear: number,
  latestFiscalPeriod: Exclude<FiscalPeriod, 'FY'>,
  count: number,
): string[] {
  const periods: string[] = []
  let year = latestFiscalYear
  let quarter = Number(latestFiscalPeriod.slice(1))
  for (let i = 0; i < count; i++) {
    periods.push(`${year}-Q${quarter}`)
    quarter -= 1
    if (quarter === 0) {
      year -= 1
      quarter = 4
    }
  }
  return periods
}
```

- [ ] **Step 4: Run the frontend helper tests**

Run:

```bash
cd web
npm test -- src/symbol/statements.test.ts
```

Expected: all tests in `src/symbol/statements.test.ts` pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/symbol/statements.ts web/src/symbol/statements.test.ts
git commit -m "feat: add fiscal quarter period helper"
```

---

### Task 5: Add Quarterly Mode to the Financials UI

**Files:**
- Modify: `web/src/pages/symbol/FinancialsSection.tsx`
- Test: `web/src/pages/symbol/FinancialsSection.test.tsx` or nearest existing financials render test

- [ ] **Step 1: Add the UI state and request behavior**

In `web/src/pages/symbol/FinancialsSection.tsx`, update imports:

```ts
import {
  fetchStatements,
  findLineValue,
  recentFiscalQuarterPeriods,
  recentFyPeriods,
  type GetStatementsResponse,
  type NormalizedStatement,
  type StatementBasis,
} from '../../symbol/statements.ts'
```

Add constants and types near `PERIOD_COUNT`:

```ts
type PeriodMode = 'annual' | 'quarterly'

const QUARTER_PERIOD_COUNT = 4
const LATEST_FISCAL_QUARTER = 'Q4' as const

const PERIOD_MODE_OPTIONS: ReadonlyArray<{ value: PeriodMode; label: string }> = [
  { value: 'annual', label: 'Annual' },
  { value: 'quarterly', label: 'Quarterly' },
]
```

Add state and include the mode in the fetch key:

```ts
const [periodMode, setPeriodMode] = useState<PeriodMode>('annual')

const statementsKey = issuerId === null ? null : `${issuerId}|${basis}|${periodMode}`
```

Replace the period construction inside the statements fetcher:

```ts
const periods = periodMode === 'annual'
  ? recentFyPeriods(LATEST_FISCAL_YEAR, PERIOD_COUNT)
  : recentFiscalQuarterPeriods(LATEST_FISCAL_YEAR, LATEST_FISCAL_QUARTER, QUARTER_PERIOD_COUNT)
```

Replace the card heading and action with:

```tsx
heading={periodMode === 'annual' ? `Income statement · last ${PERIOD_COUNT} FY` : `Income statement · last ${QUARTER_PERIOD_COUNT} quarters`}
action={
  <div className="flex flex-wrap items-center justify-end gap-2">
    <SegmentedToggle
      options={PERIOD_MODE_OPTIONS}
      value={periodMode}
      onChange={setPeriodMode}
      ariaLabel="Statement period mode"
      testIdPrefix="period-mode"
    />
    <SegmentedToggle
      options={BASIS_OPTIONS}
      value={basis}
      onChange={setBasis}
      ariaLabel="Statement basis"
      testIdPrefix="basis"
    />
  </div>
}
```

- [ ] **Step 2: Add a render test for the quarterly request**

Create `web/src/pages/symbol/FinancialsSection.test.tsx` with this focused JSDOM harness:

```tsx
import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactElement } from 'react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { FinancialsSection } from './FinancialsSection.tsx'
import type { ResolvedSubject } from '../../symbol/search.ts'

const APPLE_ISSUER_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa1'
const SOURCE_ID = '00000000-0000-4000-a000-000000000005'

test('FinancialsSection requests quarterly statement periods when quarterly mode is selected', async () => {
  const calls: Array<{ input: string; body: unknown }> = []
  const originalFetch = globalThis.fetch
  const rendered = renderFinancialsSectionForSubject({
    subject_ref: { kind: 'issuer', id: APPLE_ISSUER_ID },
    display_name: 'Apple Inc.',
    confidence: 1,
  })

  try {
    globalThis.fetch = async (input, init) => {
      if (String(input) === '/v1/fundamentals/statements') {
        const body = JSON.parse(String(init?.body))
        calls.push({ input: String(input), body })
        return new Response(JSON.stringify({
          query: body,
          results: body.periods.map((period: string) => ({
            period,
            outcome: {
              outcome: 'unavailable',
              reason: 'missing_coverage',
              subject: body.subject_ref,
              source_id: SOURCE_ID,
              as_of: '2026-05-12T00:00:00.000Z',
              retryable: false,
            },
          })),
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (String(input) === '/v1/fundamentals/segments') {
        return new Response(JSON.stringify({
          segments: {
            subject: { kind: 'issuer', id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa1' },
            axis: 'business',
            period_kind: 'fiscal_y',
            period_start: '2023-10-01',
            period_end: '2024-09-28',
            fiscal_year: 2024,
            fiscal_period: 'FY',
            basis: 'as_reported',
            reporting_currency: 'USD',
            as_of: '2026-05-12T00:00:00.000Z',
            source_id: SOURCE_ID,
            facts: [],
            segment_definitions: [],
            coverage_warnings: [],
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`unexpected fetch: ${String(input)}`)
    }

    await act(async () => {
      rendered.root.render(rendered.element)
    })
    await flushEffects()

    const button = rendered.dom.window.document.querySelector('[data-testid="period-mode-quarterly"]')
    assert.ok(button)
    await act(async () => {
      button.dispatchEvent(new rendered.dom.window.MouseEvent('click', { bubbles: true }))
    })
    await flushEffects()

    const quarterlyCall = calls.find((call) => JSON.stringify(call.body).includes('2024-Q4'))
    assert.ok(quarterlyCall)
    assert.deepEqual((quarterlyCall.body as { periods: string[] }).periods, ['2024-Q4', '2024-Q3', '2024-Q2', '2024-Q1'])
  } finally {
    await act(async () => rendered.root.unmount())
    rendered.restore()
    globalThis.fetch = originalFetch
  }
})

function renderFinancialsSectionForSubject(subject: ResolvedSubject): {
  dom: JSDOM;
  element: ReactElement;
  root: Root;
  restore: () => void;
} {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restore = installDomGlobals(dom.window as unknown as Window)
  const root = createRoot(dom.window.document.getElementById('root')!)
  const element = (
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Outlet context={{ subject }} />}>
          <Route index element={<FinancialsSection />} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
  return { dom, element, root, restore }
}

function flushEffects(): Promise<void> {
  return act(async () => undefined)
}

function installDomGlobals(domWindow: Window): () => void {
  const globals = globalThis as unknown as {
    IS_REACT_ACT_ENVIRONMENT?: boolean
    document?: Document
    window?: Window
    ResizeObserver?: typeof ResizeObserver
  }
  const hadActEnv = Object.prototype.hasOwnProperty.call(globals, 'IS_REACT_ACT_ENVIRONMENT')
  const hadDocument = Object.prototype.hasOwnProperty.call(globals, 'document')
  const hadWindow = Object.prototype.hasOwnProperty.call(globals, 'window')
  const hadResizeObserver = Object.prototype.hasOwnProperty.call(globals, 'ResizeObserver')
  const previousActEnv = globals.IS_REACT_ACT_ENVIRONMENT
  const previousDocument = globals.document
  const previousWindow = globals.window
  const previousResizeObserver = globals.ResizeObserver

  globals.IS_REACT_ACT_ENVIRONMENT = true
  globals.document = domWindow.document
  globals.window = domWindow
  globals.ResizeObserver = class {
    observe() {
      return undefined
    }
    disconnect() {
      return undefined
    }
  } as unknown as typeof ResizeObserver

  return () => {
    if (hadActEnv) globals.IS_REACT_ACT_ENVIRONMENT = previousActEnv
    else delete globals.IS_REACT_ACT_ENVIRONMENT
    if (hadDocument) globals.document = previousDocument
    else delete globals.document
    if (hadWindow) globals.window = previousWindow
    else delete globals.window
    if (hadResizeObserver) globals.ResizeObserver = previousResizeObserver
    else delete globals.ResizeObserver
  }
}
```

- [ ] **Step 3: Run the focused frontend tests**

Run:

```bash
cd web
npm test -- src/symbol/statements.test.ts src/pages/symbol/FinancialsSection.test.tsx
```

Expected: period helper and UI request tests pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/symbol/FinancialsSection.tsx web/src/pages/symbol/FinancialsSection.test.tsx
git commit -m "feat: show quarterly fundamentals mode"
```

---

### Task 6: Final Verification and Session Close

**Files:**
- No direct source edits.

- [ ] **Step 1: Run service quality gates**

Run:

```bash
cd services/fundamentals
npm test
```

Expected: all fundamentals tests pass.

- [ ] **Step 2: Run web quality gates**

Run:

```bash
cd web
npm test
```

Expected: all web tests pass.

- [ ] **Step 3: Check repository status**

Run:

```bash
git status --short
```

Expected: only intentional committed changes are present. Existing unrelated untracked generated files may remain untracked and should not be staged.

- [ ] **Step 4: Sync beads and push**

Run:

```bash
bd sync
git pull --rebase
bd sync
git push
git status
```

Expected: push succeeds and `git status` reports the branch is up to date with origin.

---

## Self-Review Notes

- Spec coverage: quarterly extraction, persistence, HTTP read contract, frontend period generation, and UI request behavior are covered.
- Granularity: each task can be implemented and committed independently.
- Known limit: this plan only covers income statements. Balance sheet and cash flow need separate concept maps and selection rules because balance sheet concepts are instant facts while income and cash flow concepts are duration facts.
