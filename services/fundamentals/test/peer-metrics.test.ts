import test from "node:test";
import assert from "node:assert/strict";

import { fetchPeerMetrics, type PeerMetricValue } from "../src/peer-metrics.ts";
import { createInMemoryStatsRepository } from "../src/stats-repository.ts";
import { mapStatement } from "../src/metric-mapper.ts";
import {
  normalizedStatement,
  type NormalizedStatementInput,
  type StatementLine,
} from "../src/statement.ts";
import {
  AAPL_FY2024_KNOWN_VALUES,
  aaplFy2024IncomeStatementInput,
  aaplIncomeMetricRegistry,
  aaplIssuer,
  SEC_EDGAR_SOURCE_ID,
} from "./fixtures.ts";

const REVENUE_FACT_ID = "f0000000-0000-4000-8000-000000000001";
const GROSS_PROFIT_FACT_ID = "f0000000-0000-4000-8000-000000000002";
const NET_INCOME_FACT_ID = "f0000000-0000-4000-8000-000000000003";
const MISSING_ISSUER_ID = "99999999-9999-4999-8999-999999999999";

// Build AAPL FY2024 mapped statement, optionally stamping persisted fact_ids
// onto specific lines (the load-from-facts path the emitter reads). Without
// stamping, the statement mimics a freshly-fetched, not-yet-persisted one.
function aaplMapped(
  factIdByKey: Readonly<Record<string, string>> = {},
  overrides: Partial<NormalizedStatementInput> = {},
  omitKeys: ReadonlyArray<string> = [],
) {
  const input = aaplFy2024IncomeStatementInput();
  const lines: StatementLine[] = input.lines
    .filter((line) => !omitKeys.includes(line.metric_key))
    .map((line) => {
      const factId = factIdByKey[line.metric_key];
      return factId === undefined ? line : { ...line, fact_id: factId };
    });
  return mapStatement(
    aaplIncomeMetricRegistry(),
    normalizedStatement({ ...input, lines, ...overrides }),
  );
}

function byMetric(metrics: ReadonlyArray<PeerMetricValue>): Map<string, PeerMetricValue> {
  return new Map(metrics.map((m) => [m.metric, m]));
}

test("fetchPeerMetrics surfaces revenue + margins with lineage from persisted statement facts", async () => {
  const repo = createInMemoryStatsRepository([
    {
      subject_id: aaplIssuer.id,
      inputs: {
        statement: aaplMapped({
          "net_sales.total": REVENUE_FACT_ID,
          gross_profit: GROSS_PROFIT_FACT_ID,
          net_income: NET_INCOME_FACT_ID,
        }),
      },
    },
  ]);

  const [aapl] = await fetchPeerMetrics(repo, [aaplIssuer.id]);
  assert.deepEqual(aapl.subject, { kind: "issuer", id: aaplIssuer.id });

  const metrics = byMetric(aapl.metrics);

  const revenue = metrics.get("revenue");
  // Revenue is reused: it points straight at its own reported fact.
  assert(revenue && revenue.kind === "reused", "revenue present + reused");
  assert.equal(revenue.value_num, AAPL_FY2024_KNOWN_VALUES.net_sales_total);
  assert.equal(revenue.format, "currency");
  assert.equal(revenue.fact_id, REVENUE_FACT_ID);

  const gross = metrics.get("gross_margin");
  assert(gross && gross.kind === "derived", "gross_margin present + derived");
  assert.equal(
    gross.value_num,
    AAPL_FY2024_KNOWN_VALUES.gross_profit / AAPL_FY2024_KNOWN_VALUES.net_sales_total,
  );
  assert.equal(gross.format, "percent");
  assert.equal(gross.source_id, SEC_EDGAR_SOURCE_ID);
  // numerator (gross_profit) then denominator (revenue) — inputRefs order.
  assert.deepEqual(gross.input_fact_ids, [GROSS_PROFIT_FACT_ID, REVENUE_FACT_ID]);

  const net = metrics.get("net_margin");
  assert(net && net.kind === "derived", "net_margin present + derived");
  assert.deepEqual(net.input_fact_ids, [NET_INCOME_FACT_ID, REVENUE_FACT_ID]);

  // operating_margin is excluded from the v1 set; P/E + growth are unavailable
  // here (no price, no prior statement) so they are omitted, not null.
  assert.deepEqual(
    new Set(aapl.metrics.map((m) => m.metric)),
    new Set(["revenue", "gross_margin", "net_margin"]),
  );
});

test("fetchPeerMetrics keeps a peer with no data instead of dropping it", async () => {
  const repo = createInMemoryStatsRepository([
    { subject_id: aaplIssuer.id, inputs: { statement: aaplMapped() } },
  ]);

  const result = await fetchPeerMetrics(repo, [MISSING_ISSUER_ID, aaplIssuer.id]);
  assert.equal(result.length, 2);

  const missing = result[0];
  assert.deepEqual(missing.subject, { kind: "issuer", id: MISSING_ISSUER_ID });
  assert.deepEqual(missing.metrics, []);
});

test("fetchPeerMetrics: not-yet-persisted statement → derived metrics keep computing (empty lineage), reused revenue is omitted", async () => {
  // No fact_ids stamped → freshly-fetched statement. Computed metrics still
  // produce a value (lineage just empty); revenue, being a `reused` pointer to
  // a fact that does not exist yet, is omitted rather than dangling.
  const repo = createInMemoryStatsRepository([
    { subject_id: aaplIssuer.id, inputs: { statement: aaplMapped() } },
  ]);

  const [aapl] = await fetchPeerMetrics(repo, [aaplIssuer.id]);
  const metrics = byMetric(aapl.metrics);

  const gross = metrics.get("gross_margin");
  assert(gross && gross.kind === "derived");
  assert.equal(
    gross.value_num,
    AAPL_FY2024_KNOWN_VALUES.gross_profit / AAPL_FY2024_KNOWN_VALUES.net_sales_total,
  );
  assert.deepEqual(gross.input_fact_ids, []);

  assert.equal(metrics.has("revenue"), false);
});

test("fetchPeerMetrics surfaces revenue_growth_yoy lineage across current + prior", async () => {
  const PRIOR_REVENUE_FACT_ID = "f0000000-0000-4000-8000-0000000000a1";
  // Prior must be current fiscal_year - 1 (FY) or the growth value is blocked.
  const prior = aaplMapped(
    { "net_sales.total": PRIOR_REVENUE_FACT_ID },
    {
      fiscal_year: 2023,
      period_start: "2022-09-25",
      period_end: "2023-09-30",
      as_of: "2023-11-03T20:30:00.000Z",
      reported_at: "2023-11-03T20:30:00.000Z",
    },
  );
  const current = aaplMapped({ "net_sales.total": REVENUE_FACT_ID });

  const repo = createInMemoryStatsRepository([
    {
      subject_id: aaplIssuer.id,
      inputs: { statement: current, prior_statement: prior },
    },
  ]);

  const [aapl] = await fetchPeerMetrics(repo, [aaplIssuer.id]);
  const growth = byMetric(aapl.metrics).get("revenue_growth_yoy");
  assert(growth && growth.kind === "derived", "revenue_growth_yoy present when a prior statement exists");
  assert.equal(growth.format, "percent");
  // current revenue then prior revenue — inputRefs builds current first.
  assert.deepEqual(growth.input_fact_ids, [REVENUE_FACT_ID, PRIOR_REVENUE_FACT_ID]);
});

test("fetchPeerMetrics never surfaces prior-year revenue when the current statement lacks it", async () => {
  const PRIOR_REVENUE_FACT_ID = "f0000000-0000-4000-8000-0000000000b2";
  // Current statement is missing its revenue line; only the prior carries one
  // (as the growth stat's role:"prior" input). Revenue must be ABSENT, not stale.
  const current = aaplMapped({}, {}, ["net_sales.total"]);
  const prior = aaplMapped(
    { "net_sales.total": PRIOR_REVENUE_FACT_ID },
    {
      fiscal_year: 2023,
      period_start: "2022-09-25",
      period_end: "2023-09-30",
      as_of: "2023-11-03T20:30:00.000Z",
      reported_at: "2023-11-03T20:30:00.000Z",
    },
  );

  const repo = createInMemoryStatsRepository([
    { subject_id: aaplIssuer.id, inputs: { statement: current, prior_statement: prior } },
  ]);

  const [aapl] = await fetchPeerMetrics(repo, [aaplIssuer.id]);
  assert.equal(byMetric(aapl.metrics).has("revenue"), false);
});
