import assert from "node:assert/strict";
import test from "node:test";

import type { IssuerFundamentalFact } from "../../fundamentals/src/issuer-fundamentals-reader.ts";
import { formatPercent } from "../../analyze/src/block-format.ts";
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
    period_kind: fiscal_period === "FY" ? "fiscal_y" : "fiscal_q",
    fiscal_year,
    fiscal_period,
    as_of: `2026-0${(nextId % 8) + 1}-01T00:00:00.000Z`,
    source_id: SOURCE,
    coverage_level: "full",
  };
}

function derive(facts: ReadonlyArray<IssuerFundamentalFact>, opts: { noDatesFor?: string; shiftedDatesFor?: string } = {}) {
  const key = (m: string, y: number, p: string) => `${m}|${y}|${p}`;
  const byKey = new Map(facts.map((f) => [key(f.metric_key, f.fiscal_year!, f.fiscal_period!), f]));
  const shownRevenue = facts.filter((f) => f.metric_key === "revenue");
  return deriveQuarterMetrics({
    shownRevenue,
    fact: (m, y, p) => byKey.get(key(m, y, p)),
    period: (id) => id === opts.noDatesFor ? undefined
      : id === opts.shiftedDatesFor ? { fact_id: id, period_kind: "fiscal_q", period_start: "2025-11-03", period_end: "2026-02-01" }
      : { fact_id: id, period_kind: "fiscal_q", period_start: "2025-10-27", period_end: "2026-01-25" },
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

test("no margin when the line and revenue under one quarter label cover different dates", () => {
  const revenue = fact("revenue", 2026, "Q1", 10e9);
  const gross = fact("gross_profit", 2026, "Q1", 5e9);
  assert.deepEqual(derive([revenue, gross], { shiftedDatesFor: gross.fact_id }), []);
  assert.equal(derive([revenue, gross]).length, 1, "the same dates still derive the margin");
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

test("growth is computed for the quarter named, not the window's last (#292 review)", () => {
  const facts = [
    fact("revenue", 2025, "Q1", 100), fact("revenue", 2025, "Q2", 110), fact("revenue", 2025, "Q3", 150),
    fact("revenue", 2024, "Q2", 80),
  ];
  const key = (m: string, y: number, p: string) => `${m}|${y}|${p}`;
  const byKey = new Map(facts.map((f) => [key(f.metric_key, f.fiscal_year!, f.fiscal_period!), f]));
  const named = facts[1]!;
  const specs = deriveQuarterMetrics({
    shownRevenue: facts.slice(0, 3),
    growthAt: named,
    fact: (m, y, p) => byKey.get(key(m, y, p)),
    period: (id) => ({ fact_id: id, period_kind: "fiscal_q", period_start: "2025-03-30", period_end: "2025-06-28" }),
  });
  const growth = specs.filter((spec) => spec.metric.startsWith("revenue_growth"));
  // Q2 2025: QoQ from Q1 (100 -> 110), YoY from Q2 2024 (80 -> 110).
  assert.deepEqual(growth.map((spec) => [spec.period.fiscal_period, spec.period.fiscal_year, Number(spec.value_num.toFixed(3))]), [["Q2", 2025, 0.1], ["Q2", 2025, 0.375]]);
});

// NVDA's reported revenue ($M), Q1 2025..Q4 2026 (test/golden/dataset.ts).
const NVDA_REVENUE = [26044, 30040, 35082, 39331, 44062, 46743, 57006, 62100];

function windowed(window: ReadonlyArray<IssuerFundamentalFact>, growthAt: IssuerFundamentalFact) {
  const key = (m: string, y: number, p: string) => `${m}|${y}|${p}`;
  const byKey = new Map(window.map((f) => [key(f.metric_key, f.fiscal_year!, f.fiscal_period!), f]));
  const specs = deriveQuarterMetrics({
    shownRevenue: [growthAt],
    window,
    growthAt,
    fact: (m, y, p) => byKey.get(key(m, y, p)),
    period: (id) => ({ fact_id: id, period_kind: "fiscal_q", period_start: "2025-07-28", period_end: "2025-10-26" }),
  });
  return specs
    .filter((spec) => spec.metric === "revenue_growth_qoq")
    .map((spec) => [`${spec.period.fiscal_period} ${spec.period.fiscal_year}`, formatPercent(spec.value_num), spec.input_fact_ids, spec.label]);
}

function nvdaQuarters(values: ReadonlyArray<number> = NVDA_REVENUE): IssuerFundamentalFact[] {
  return values.map((value, i) => fact("revenue", 2025 + Math.floor(i / 4), `Q${(i % 4) + 1}`, value * 1e6));
}

test("QoQ growth for every quarter of the revenue window whose previous quarter is in it, from exact values", () => {
  const q = nvdaQuarters();
  const ids = (at: number) => [q[at]!.fact_id, q[at - 1]!.fact_id];
  const label = "Revenue growth (QoQ)";
  assert.deepEqual(windowed(q, q[7]!), [
    // The latest quarter's, as before; then the window's, oldest first.
    ["Q4 2026", "8.9%", ids(7), label],
    ["Q2 2025", "15.3%", ids(1), label],
    ["Q3 2025", "16.8%", ids(2), label],
    ["Q4 2025", "12.1%", ids(3), label],
    // 44062/39331; the bars' $44.1B/$39.3B would give 12.2%.
    ["Q1 2026", "12.0%", ids(4), label],
    ["Q2 2026", "6.1%", ids(5), label],
    ["Q3 2026", "22.0%", ids(6), label],
  ]);
});

test("a named quarter's QoQ is computed once, and the window's later quarters still get theirs", () => {
  const q = nvdaQuarters();
  assert.deepEqual(windowed(q, q[5]!).map(([period]) => period), ["Q2 2026", "Q2 2025", "Q3 2025", "Q4 2025", "Q1 2026", "Q3 2026", "Q4 2026"]);
});

test("no QoQ for the quarter after a gap in the window, or from a zero or negative base", () => {
  const q = nvdaQuarters();
  // Q2 2026 is missing: none for Q3 2026, whose previous quarter is not shown.
  const gap = [...q.slice(0, 5), ...q.slice(6)];
  assert.deepEqual(windowed(gap, gap.at(-1)!).map(([period]) => period), ["Q4 2026", "Q2 2025", "Q3 2025", "Q4 2025", "Q1 2026"]);
  // Q3 2025 grows from zero and Q1 2026 from a loss: neither gets one.
  const based = nvdaQuarters([100, 0, 50, -20, 30, 40]);
  assert.deepEqual(windowed(based, based.at(-1)!).map(([period, value]) => [period, value]), [
    ["Q2 2026", "33.3%"],
    ["Q2 2025", "-100.0%"],
    ["Q4 2025", "-140.0%"],
  ]);
});
