import assert from "node:assert/strict";
import test from "node:test";

import type { IssuerFundamentalFact } from "../../fundamentals/src/issuer-fundamentals-reader.ts";
import { deriveQuarterMetrics, quarterBefore } from "../src/quarter-metrics.ts";

const SOURCE = "00000000-0000-4000-a000-000000000001";
let nextId = 0;
function fact(metric_key: string, fiscal_year: number, fiscal_period: string, value_num: number, currency = "USD"): IssuerFundamentalFact {
  nextId += 1;
  return {
    fact_id: `f${nextId}`,
    metric_key,
    display_name: metric_key,
    value_num,
    value_text: null,
    unit: "currency",
    currency,
    scale: 1,
    fiscal_year,
    fiscal_period,
    as_of: `2026-0${(nextId % 8) + 1}-01T00:00:00.000Z`,
    source_id: SOURCE,
    coverage_level: "full",
  };
}

function derive(facts: ReadonlyArray<IssuerFundamentalFact>, opts: { noDatesFor?: string } = {}) {
  const key = (m: string, y: number, p: string) => `${m}|${y}|${p}`;
  const byKey = new Map(facts.map((f) => [key(f.metric_key, f.fiscal_year!, f.fiscal_period!), f]));
  const shownRevenue = facts.filter((f) => f.metric_key === "revenue");
  return deriveQuarterMetrics({
    shownRevenue,
    fact: (m, y, p) => byKey.get(key(m, y, p)),
    period: (id) => id === opts.noDatesFor ? undefined : { fact_id: id, period_kind: "fiscal_q", period_start: "2025-10-27", period_end: "2026-01-25" },
  });
}

test("quarterBefore steps back across fiscal years", () => {
  assert.deepEqual(quarterBefore(2026, "Q1", 1), { fiscal_year: 2025, fiscal_period: "Q4" });
  assert.deepEqual(quarterBefore(2026, "Q3", 4), { fiscal_year: 2025, fiscal_period: "Q3" });
  assert.equal(quarterBefore(2026, "FY", 1), null);
});

test("margins are each statement line over revenue, with lineage to both facts", () => {
  const revenue = fact("revenue", 2026, "Q1", 44.1e9);
  const gross = fact("gross_profit", 2026, "Q1", 26.7e9);
  const operating = fact("operating_income", 2025, "Q2", -134e6); // a loss quarter, but another quarter
  const loss = fact("operating_income", 2026, "Q1", -0.8e9);
  const metrics = derive([revenue, gross, operating, loss]);

  const grossMargin = metrics.find((m) => m.metric === "gross_margin")!;
  assert.equal(grossMargin.value_num, 26.7e9 / 44.1e9);
  assert.equal(grossMargin.unit, "ratio");
  assert.equal(grossMargin.label, "Gross margin");
  assert.deepEqual(grossMargin.input_fact_ids, [gross.fact_id, revenue.fact_id]);
  assert.deepEqual([grossMargin.period.fiscal_year, grossMargin.period.fiscal_period, grossMargin.period.period_end], [2026, "Q1", "2026-01-25"]);
  assert.equal(grossMargin.as_of, [gross.as_of, revenue.as_of].sort().at(-1), "known once both inputs are");
  // A loss is a negative margin, not dropped.
  assert.ok(metrics.find((m) => m.metric === "operating_margin")!.value_num < 0);
  // No net income reported for the quarter: no net margin.
  assert.equal(metrics.find((m) => m.metric === "net_margin"), undefined);
});

test("a derived value is only as complete as its least complete input", () => {
  const revenue = fact("revenue", 2026, "Q1", 10e9);
  const gross = { ...fact("gross_profit", 2026, "Q1", 5e9), coverage_level: "partial" };
  const margin = derive([revenue, gross]).find((m) => m.metric === "gross_margin")!;
  assert.equal(margin.coverage_level, "partial");
});

test("no margin from mixed currencies, zero revenue, or a quarter without period dates", () => {
  const eur = fact("revenue", 2026, "Q1", 10e9, "EUR");
  assert.deepEqual(derive([eur, fact("gross_profit", 2026, "Q1", 5e9, "USD")]), []);
  assert.deepEqual(derive([fact("revenue", 2026, "Q1", 0), fact("gross_profit", 2026, "Q1", 5e9)]), []);
  const revenue = fact("revenue", 2026, "Q1", 10e9);
  assert.deepEqual(derive([revenue, fact("gross_profit", 2026, "Q1", 5e9)], { noDatesFor: revenue.fact_id }), []);
});

test("the latest quarter gets QoQ and YoY revenue growth from the right earlier quarters", () => {
  const yearAgo = fact("revenue", 2025, "Q1", 26.0e9);
  const previous = fact("revenue", 2025, "Q4", 39.3e9);
  const latest = fact("revenue", 2026, "Q1", 44.1e9);
  const metrics = derive([yearAgo, previous, latest]);

  const qoq = metrics.find((m) => m.metric === "revenue_growth_qoq")!;
  const yoy = metrics.find((m) => m.metric === "revenue_growth_yoy")!;
  assert.equal(qoq.value_num, (44.1e9 - 39.3e9) / 39.3e9);
  assert.equal(yoy.value_num, (44.1e9 - 26.0e9) / 26.0e9);
  assert.deepEqual(qoq.input_fact_ids, [latest.fact_id, previous.fact_id]);
  assert.deepEqual([qoq.period.fiscal_year, qoq.period.fiscal_period], [2026, "Q1"]);
  // Only for the latest quarter: no growth for earlier ones.
  assert.equal(metrics.filter((m) => m.metric.startsWith("revenue_growth")).length, 2);
});

test("no growth without the earlier quarter, or from a zero base", () => {
  assert.deepEqual(derive([fact("revenue", 2026, "Q1", 44.1e9)]), []);
  assert.deepEqual(
    derive([fact("revenue", 2025, "Q4", 0), fact("revenue", 2026, "Q1", 44.1e9)]).map((m) => m.metric),
    [],
  );
});
