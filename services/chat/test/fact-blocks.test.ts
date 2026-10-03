import assert from "node:assert/strict";
import test from "node:test";

import type { IssuerFundamentalFact } from "../../fundamentals/src/issuer-fundamentals-reader.ts";
import type { VerifierFact } from "../../snapshot/src/snapshot-verifier.ts";
import {
  buildIssuerFactBlocks,
  comparisonTitle,
  displayedFigures,
  listingsForComparison,
  loadTurnFactBlocks,
  priceListingsForComparison,
  requestedFiscalYear,
  requestedPriceWindow,
  segmentRevenueItems,
  type DerivedQuarterFact,
} from "../src/fact-blocks.ts";
import { deriveQuarterMetrics } from "../src/quarter-metrics.ts";
import { fakeQuery } from "./fake-query.ts";

const SNAPSHOT_ID = "11111111-1111-4111-a111-111111111111";
const AS_OF = "2026-09-01T00:00:00.000Z";
const SOURCE_ID = "00000000-0000-4000-a000-000000000001";

let nextId = 0;
function fact(metric_key: string, fiscal_year: number, fiscal_period: string, value_num: number): IssuerFundamentalFact {
  nextId += 1;
  return {
    fact_id: `f0000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`,
    metric_key,
    display_name: metric_key,
    value_num,
    value_text: null,
    unit: "currency",
    currency: "USD",
    scale: 1,
    fiscal_year,
    fiscal_period,
    as_of: AS_OF,
    source_id: SOURCE_ID,
    coverage_level: "full",
  };
}

function verifierFacts(facts: ReadonlyArray<IssuerFundamentalFact>): VerifierFact[] {
  return facts.map((f) => ({
    fact_id: f.fact_id,
    source_id: f.source_id,
    unit: "currency",
    period_kind: "fiscal_q",
    period_start: null,
    period_end: null,
    as_of: AS_OF,
    fiscal_year: f.fiscal_year,
    fiscal_period: f.fiscal_period,
  }));
}

function quarters(count: number): IssuerFundamentalFact[] {
  const out: IssuerFundamentalFact[] = [];
  for (let i = 0; i < count; i += 1) {
    const year = 2024 + Math.floor(i / 4);
    const period = `Q${(i % 4) + 1}`;
    const revenue = (i + 1) * 1e9;
    out.push(
      fact("revenue", year, period, revenue),
      fact("gross_profit", year, period, revenue * 0.6),
      fact("operating_income", year, period, revenue * 0.4),
      fact("net_income", year, period, revenue * 0.3),
    );
  }
  return out;
}

function blocksFor(facts: ReadonlyArray<IssuerFundamentalFact>) {
  return buildIssuerFactBlocks({ facts, verifierFacts: verifierFacts(facts), snapshotId: SNAPSHOT_ID, asOf: AS_OF });
}

test("builds a latest-quarter metric_row and an 8-quarter revenue_bars chart, oldest first", () => {
  const facts = quarters(10);
  const [metricRow, bars] = blocksFor(facts);

  assert.equal(metricRow.kind, "metric_row");
  assert.deepEqual(
    (metricRow.items as Array<{ label: string }>).map((item) => item.label),
    ["Revenue", "Gross profit", "Operating income", "Net income"],
  );
  assert.match(String(metricRow.title), /Q2 2026/);

  assert.equal(bars.kind, "revenue_bars");
  const barLabels = (bars.bars as Array<{ label: string }>).map((bar) => bar.label);
  assert.equal(barLabels.length, 8);
  assert.equal(barLabels[0], "Q3 2024");
  assert.equal(barLabels.at(-1), "Q2 2026");
});

test("every rendered value is a cited, bound fact with its source on the block", () => {
  for (const block of blocksFor(quarters(3))) {
    const valueRefs = JSON.stringify(block).match(/"value_ref":"([^"]+)"/g)?.map((m) => m.slice(13, -1)) ?? [];
    assert.ok(valueRefs.length > 0, `${block.kind} renders no facts`);
    const params = (block.data_ref as { params?: { fact_bindings?: Array<{ fact_id: string }> } }).params;
    const bound = new Set(params?.fact_bindings?.map((binding) => binding.fact_id));
    const cited = new Set(block.provenance_fact_refs as string[]);
    for (const ref of valueRefs) {
      assert.ok(bound.has(ref), `${block.kind}: ${ref} has no fact binding`);
      assert.ok(cited.has(ref), `${block.kind}: ${ref} is not cited`);
    }
    assert.deepEqual(block.source_refs, [SOURCE_ID]);
    assert.equal(block.snapshot_id, SNAPSHOT_ID);
    assert.deepEqual((block.data_ref as { kind: string }).kind, block.kind);
  }
});

// Margins and growth as the loader mints them: computed from the facts, given ids
// and the verifier's bindings (derived facts carry the quarter's period dates).
function derivedFor(facts: ReadonlyArray<IssuerFundamentalFact>): DerivedQuarterFact[] {
  const key = (m: string, y: number, p: string) => `${m}|${y}|${p}`;
  const byKey = new Map(facts.map((f) => [key(f.metric_key, f.fiscal_year!, f.fiscal_period!), f]));
  const revenue = facts.filter((f) => f.metric_key === "revenue").slice(-8);
  const specs = deriveQuarterMetrics({
    shownRevenue: revenue,
    fact: (m, y, p) => byKey.get(key(m, y, p)),
    period: (id) => ({ fact_id: id, period_kind: "fiscal_q", period_start: null, period_end: "2026-01-25" }),
  });
  return specs.map((spec, index) => {
    const fact_id = `d0000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    return { ...spec, fact_id, binding: { fact_id, source_id: SOURCE_ID, unit: "ratio", period_kind: "fiscal_q", as_of: AS_OF } };
  });
}

function blocksWithDerived(facts: ReadonlyArray<IssuerFundamentalFact>, wantsMarginTrend: boolean) {
  return buildIssuerFactBlocks({
    facts,
    verifierFacts: verifierFacts(facts),
    derived: derivedFor(facts),
    wantsMarginTrend,
    snapshotId: SNAPSHOT_ID,
    asOf: AS_OF,
  });
}

test("the latest quarter shows its margins and QoQ/YoY revenue growth, each a cited derived fact", () => {
  const [metricRow] = blocksWithDerived(quarters(10), false);
  const items = metricRow.items as Array<{ label: string; format: string; value_ref: string }>;
  assert.deepEqual(items.map((item) => item.label), [
    "Revenue", "Gross profit", "Operating income", "Net income",
    "Gross margin", "Operating margin", "Net margin", "Revenue growth (QoQ)", "Revenue growth (YoY)",
  ]);
  // quarters(): margins 60/40/30%; revenue 10B after 9B (QoQ 11.1%) and 6B a year earlier (YoY 66.7%).
  assert.deepEqual(items.slice(4).map((item) => item.format), ["60.0%", "40.0%", "30.0%", "11.1%", "66.7%"]);
  const cited = new Set(metricRow.provenance_fact_refs as string[]);
  for (const item of items) assert.ok(cited.has(item.value_ref), `${item.label} is not cited`);
});

test("a derived figure cites every input's fact and source, not only revenue's", () => {
  const OTHER_SOURCE = "00000000-0000-4000-a000-000000000002";
  // The latest gross profit comes from a different filing than its revenue.
  const facts = quarters(10).map((f, i, all) =>
    f.metric_key === "gross_profit" && i === all.findLastIndex((g) => g.metric_key === "gross_profit") ? { ...f, source_id: OTHER_SOURCE } : f);
  const [metricRow] = blocksWithDerived(facts, false);
  assert.ok((metricRow.source_refs as string[]).includes(OTHER_SOURCE), "the margin's numerator source is cited");
  const cited = new Set(metricRow.provenance_fact_refs as string[]);
  const derived = derivedFor(facts).filter((d) => (metricRow.items as Array<{ value_ref: string }>).some((item) => item.value_ref === d.fact_id));
  for (const d of derived) for (const input of d.input_fact_ids) assert.ok(cited.has(input), `${d.metric} input ${input} is not cited`);
  // Each cited fact is bound, so the seal can load it.
  const bound = new Set((metricRow.data_ref as { params: { fact_bindings: Array<{ fact_id: string }> } }).params.fact_bindings.map((b) => b.fact_id));
  for (const ref of cited) assert.ok(bound.has(ref), `${ref} is cited but not bound`);
});

test("a margin question also gets each margin across the quarters shown; others don't", () => {
  const facts = quarters(10);
  assert.equal(blocksWithDerived(facts, false).length, 2);
  const trend = blocksWithDerived(facts, true).slice(2);
  assert.deepEqual(trend.map((block) => block.title), ["Gross margin by quarter", "Operating margin by quarter", "Net margin by quarter"]);
  const cells = trend[1]!.items as Array<{ label: string; format: string }>;
  assert.deepEqual([cells.length, cells[0]!.label, cells.at(-1)!.label, cells[0]!.format], [8, "Q3 2024", "Q2 2026", "40.0%"]);
  // Each row is its own block (distinct ids) and every cell cites a bound fact.
  assert.equal(new Set(trend.map((block) => block.id)).size, 3);
  for (const block of trend) {
    const bound = new Set((block.data_ref as { params: { fact_bindings: Array<{ fact_id: string }> } }).params.fact_bindings.map((b) => b.fact_id));
    for (const cell of block.items as Array<{ value_ref: string }>) assert.ok(bound.has(cell.value_ref));
  }
});

test("the model sees a margin-trend cell as that margin in that quarter", () => {
  const figures = displayedFigures(blocksWithDerived(quarters(10), true));
  assert.ok(figures.some((f) => f.metric === "Operating margin" && f.period === "Q3 2024" && f.value === "40.0%"));
  assert.ok(figures.some((f) => f.metric === "Gross margin" && f.period === undefined && f.value === "60.0%"), "latest-quarter row");
});

test("bindings carry the verifier's fact metadata without the source id", () => {
  const facts = quarters(1);
  const [metricRow] = blocksFor(facts);
  const binding = (metricRow.data_ref as { params: { fact_bindings: Array<Record<string, unknown>> } })
    .params.fact_bindings[0];
  assert.equal(binding.source_id, undefined);
  assert.equal(binding.period_kind, "fiscal_q");
  assert.equal(binding.fiscal_period, "Q1");
});

test("metric_row omits metrics the latest quarter does not report", () => {
  const facts = [fact("revenue", 2026, "Q1", 5e9), fact("net_income", 2026, "Q1", 1e9)];
  const [metricRow] = blocksFor(facts);
  assert.deepEqual(
    (metricRow.items as Array<{ label: string }>).map((item) => item.label),
    ["Revenue", "Net income"],
  );
});

test("no quarterly revenue means no fact blocks", () => {
  assert.deepEqual(blocksFor([fact("net_income", 2026, "Q1", 1e9)]), []);
  assert.deepEqual(blocksFor([]), []);
});

test("facts the verifier cannot load are left out rather than rendered unbound", () => {
  const facts = quarters(2);
  const loadable = verifierFacts(facts).filter((f) => f.fact_id !== facts[0].fact_id);
  const blocks = buildIssuerFactBlocks({ facts, verifierFacts: loadable, snapshotId: SNAPSHOT_ID, asOf: AS_OF });
  assert.equal(JSON.stringify(blocks).includes(facts[0].fact_id), false);
});

test("a comparison charts the listing the user asked for, not an arbitrary one of the issuer's", () => {
  const issuer = "60000000-0000-4000-8000-000000000001";
  const peer = "60000000-0000-4000-8000-000000000002";
  const listings = listingsForComparison(
    [issuer, peer],
    new Map([[issuer, { listing_id: "listing-requested", label: "GOOG" }]]),
    new Map([
      [issuer, { listing_id: "listing-alphabetical", label: "GOOGA" }],
      [peer, { listing_id: "listing-peer", label: "MSFT" }],
    ]),
  );
  assert.deepEqual(listings.get(issuer), { listing_id: "listing-requested", label: "GOOG" });
  // Auto-selected peers were never resolved, so they use the issuer's active listing.
  assert.deepEqual(listings.get(peer), { listing_id: "listing-peer", label: "MSFT" });
});

test("the price chart gets every compared company's listing, or none when one has no listing", () => {
  const companies = new Map<string, { listing_id: string | null; label: string }>([
    ["i1", { listing_id: "l1", label: "NVDA" }],
    ["i2", { listing_id: "l2", label: "AMD" }],
  ]);
  assert.deepEqual(priceListingsForComparison(["i1", "i2"], companies), [
    { id: "l1", label: "NVDA" },
    { id: "l2", label: "AMD" },
  ]);
  assert.deepEqual(priceListingsForComparison(["i1", "i2", "i3"], companies), []);
  const unlisted = new Map([...companies, ["i3", { listing_id: null, label: "Private Co" }]]);
  assert.deepEqual(priceListingsForComparison(["i1", "i2", "i3"], unlisted), []);
});

test("a comparison keeps its price chart when the fundamentals are unavailable", async (t) => {
  t.mock.method(console, "warn", () => {});
  const issuers = [
    { kind: "issuer" as const, id: "64000000-0000-4000-8000-000000000001" },
    { kind: "issuer" as const, id: "64000000-0000-4000-8000-000000000002" },
  ];
  const listingIds = ["64000000-0000-4000-8000-00000000000a", "64000000-0000-4000-8000-00000000000b"];
  const asOf = "2026-09-01T00:00:00.000Z";
  const query = fakeQuery((text) => {
    if (text.includes("from issuers i")) {
      return { rows: issuers.map((issuer, i) => ({ issuer_id: issuer.id, listing_id: listingIds[i], ticker: `T${i}`, legal_name: `Co ${i}` })) };
    }
    if (text.includes("market_bar_ranges")) {
      return {
        rows: listingIds.map((listingId, i) => ({
          bar_range_id: `64000000-0000-4000-8000-00000000010${i}`,
          listing_id: listingId,
          adjustment_basis: "split_adjusted",
          source_id: "00000000-0000-4000-a000-000000000009",
          delay_class: "eod",
          range_start: "2026-08-22T00:00:00.000Z",
          range_end: asOf,
          as_of: asOf,
          bars: [
            { ts: "2026-08-22T00:00:00.000Z", close: 100 + i },
            { ts: "2026-08-23T00:00:00.000Z", close: 110 + i },
          ],
        })),
      };
    }
    throw new Error("fundamentals unavailable");
  });
  const blocks = await loadTurnFactBlocks({ query } as never, {
    issuers,
    wantsPeers: false,
    snapshotId: "64000000-0000-4000-8000-0000000000ff",
    asOf,
  });
  assert.deepEqual(blocks.map((block) => block.kind), ["perf_comparison", "disclosure"]);
  assert.deepEqual(blocks[0].subject_labels, ["T0", "T1"]);
});

test("a segment breakdown lists the latest quarter's segments, largest first, each citing its fact", () => {
  const row = (name: string, value: number, fiscal_year: number, fiscal_period: string, coverage_level = "full", currency = "USD") => ({
    fact_id: `${name}-${fiscal_year}-${fiscal_period}`,
    name,
    value,
    currency,
    fiscal_year,
    fiscal_period,
    coverage_level,
  });
  const breakdown = segmentRevenueItems([
    row("Gaming", 4.3e9, 2026, "Q4"),
    row("Data Center", 55.2e9, 2026, "Q4"),
    row("Data Center", 51e9, 2026, "Q3"),
  ]);
  assert.ok(breakdown);
  assert.equal(breakdown.period, "Q4 2026");
  assert.deepEqual(breakdown.items.map((item) => item.label), ["Data Center", "Gaming"]);
  assert.deepEqual(breakdown.items.map((item) => item.value_ref), ["Data Center-2026-Q4", "Gaming-2026-Q4"]);
  assert.equal(breakdown.items[0].format, "$55.2B");
  assert.equal(segmentRevenueItems([]), null);
  // An inherited property name is not a quarter.
  assert.equal(segmentRevenueItems([row("Data Center", 55.2e9, 2026, "toString")])?.period ?? null, null);
  // A partial segment would pass an incomplete breakdown off as whole: show none.
  assert.equal(segmentRevenueItems([row("Data Center", 55.2e9, 2026, "Q4"), row("Gaming", 4.3e9, 2026, "Q4", "partial")]), null);
  // An unknown currency is not USD.
  assert.equal(segmentRevenueItems([row("Data Center", 55.2e9, 2026, "Q4", "full", null as unknown as string)]), null);
  // Values in different currencies cannot be ranked or summed.
  assert.equal(segmentRevenueItems([row("Data Center", 55.2e9, 2026, "Q4"), row("Gaming", 4.3e9, 2026, "Q4", "full", "EUR")]), null);
});

test("a question's named fiscal year is read in its common spellings (#180)", () => {
  assert.equal(requestedFiscalYear("Compare NVDA's and AAPL's fiscal 2025 revenue."), 2025);
  assert.equal(requestedFiscalYear("NVDA vs AMD fiscal year 2024 margins"), 2024);
  assert.equal(requestedFiscalYear("FY25 revenue for AAPL and NVDA"), 2025);
  assert.equal(requestedFiscalYear("their FY 2026 results"), 2026);
  assert.equal(requestedFiscalYear("the 2025 fiscal year"), 2025);
  assert.equal(requestedFiscalYear("Compare NVDA and AMD revenue in 2025"), undefined, "a calendar year is not a fiscal one");
  assert.equal(requestedFiscalYear("Compare NVDA and AMD"), undefined);
});

test("the comparison title names each company's period and end, and a fiscal-calendar gap (#180)", () => {
  assert.equal(
    comparisonTitle(["NVDA", "AAPL"], [
      { fiscal_year: 2025, period_end: "2025-01-26" },
      { fiscal_year: 2025, period_end: "2025-09-27" },
    ], 2025),
    "Side by side: NVDA FY2025 (ended Jan 2025), AAPL FY2025 (ended Sep 2025); fiscal years end 8 months apart",
  );
  // Ends a month apart are the same season: no note.
  assert.equal(
    comparisonTitle(["NVDA", "AMD"], [
      { fiscal_year: 2026, period_end: "2026-01-25" },
      { fiscal_year: 2025, period_end: "2025-12-27" },
    ], undefined),
    "Side by side: NVDA FY2026 (ended Jan 2026), AMD FY2025 (ended Dec 2025)",
  );
  // A company without the year asked for says so; nothing is substituted.
  assert.equal(
    comparisonTitle(["NVDA", "AMD", "AAPL"], [
      { fiscal_year: 2025, period_end: "2025-01-26" },
      undefined,
      { fiscal_year: 2025, period_end: "2025-09-27" },
    ], 2025),
    "Side by side: NVDA FY2025 (ended Jan 2025), AMD: no FY2025 figures, AAPL FY2025 (ended Sep 2025); fiscal years end 8 months apart",
  );
});

test("the model sees each comparison figure's period and end date (#180)", () => {
  const [figure] = displayedFigures([{
    kind: "metrics_comparison",
    title: "Side by side",
    subject_labels: ["NVDA"],
    metrics: ["Revenue"],
    cells: [[{ value_ref: "fact-1", format: "$130.5B" }]],
    data_ref: { params: { fact_bindings: [{ fact_id: "fact-1", fiscal_year: 2025, fiscal_period: "FY", period_end: "2025-01-26" }] } },
  }]);
  assert.deepEqual(figure, {
    company: "NVDA",
    metric: "Revenue",
    period: "FY2025",
    period_end: "2025-01-26",
    value: "$130.5B",
    shown_in: "Side by side",
  });
});

test("a question asking for year to date gets the YTD price window (#192)", () => {
  assert.equal(requestedPriceWindow("Compare NVDA with AMD YTD"), "ytd");
  assert.equal(requestedPriceWindow("How have NVDA and AMD done year-to-date?"), "ytd");
  assert.equal(requestedPriceWindow("NVDA vs AMD year to date"), "ytd");
  assert.equal(requestedPriceWindow("Compare NVDA with AMD"), undefined);
});

test("the model sees a price chart's return per company over its window (#181)", () => {
  const figures = displayedFigures([{
    kind: "perf_comparison",
    title: "Price return YTD 2026 (split-adjusted, excluding dividends)",
    default_range: "YTD 2026: 2025-12-31 close to 2026-08-31 close",
    series: [
      { name: "NVDA", unit: "%", points: [{ x: "2025-12-31", y: 0 }, { x: "2026-08-31", y: 20 }] },
      { name: "AMD", unit: "%", points: [{ x: "2025-12-31", y: 0 }, { x: "2026-08-31", y: -4.25 }] },
      { name: "AAPL", unit: "%", points: [{ x: "2025-12-31", y: 0 }, { x: "2026-08-31", y: -0.04 }] },
    ],
  }]);
  // At the chart tooltip's precision (up to two decimals), so a small move isn't rounded away.
  assert.deepEqual(figures.map((figure) => [figure.company, figure.metric, figure.value, figure.period]), [
    ["NVDA", "Price return", "20%", "YTD 2026: 2025-12-31 close to 2026-08-31 close"],
    ["AMD", "Price return", "-4.25%", "YTD 2026: 2025-12-31 close to 2026-08-31 close"],
    ["AAPL", "Price return", "-0.04%", "YTD 2026: 2025-12-31 close to 2026-08-31 close"],
  ]);
});
