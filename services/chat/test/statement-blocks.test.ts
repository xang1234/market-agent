import assert from "node:assert/strict";
import test from "node:test";

import type { IssuerFundamentalFact } from "../../fundamentals/src/issuer-fundamentals-reader.ts";
import type { VerifierFact } from "../../snapshot/src/snapshot-verifier.ts";
import {
  displayedFigures,
  mayOfferOtherFacts,
  scopeGapBlocks,
  withDerivationSources,
  type DerivedQuarterFact,
} from "../src/fact-blocks.ts";
import { resolveResearchScope, type ResearchScope, type ScopeProposal } from "../src/research-scope.ts";
import { proposal } from "./scope-fixtures.ts";
import {
  buildStatementBlocks,
  freeCashFlowSpecs,
  loadStatementBlocks,
  statementFacets,
  type StatementFacets,
} from "../src/statement-blocks.ts";
import { fakeQuery } from "./fake-query.ts";

const SNAPSHOT_ID = "11111111-1111-4111-a111-111111111111";
const AS_OF = "2026-09-01T00:00:00.000Z";
const SOURCE_ID = "00000000-0000-4000-a000-000000000001";
const CAPEX_SOURCE_ID = "00000000-0000-4000-a000-000000000002";
const NVDA = { issuer_id: "60000000-0000-4000-8000-000000000001", label: "NVDA" };
const AMD = { issuer_id: "60000000-0000-4000-8000-000000000002", label: "AMD" };
const ALL = { cashFlow: true, balanceSheet: true, eps: true };

type Dated = { period_kind: string; period_start: string | null; period_end: string };
let nextId = 0;
const dates = new Map<string, Dated>();

function fact(
  metric_key: string,
  fiscal_year: number,
  fiscal_period: string,
  value_num: number,
  period: Dated,
  overrides: Partial<IssuerFundamentalFact> = {},
): IssuerFundamentalFact {
  nextId += 1;
  const fact_id = `f0000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`;
  dates.set(fact_id, period);
  return {
    fact_id,
    metric_key,
    display_name: metric_key,
    value_num,
    value_text: null,
    unit: "currency",
    currency: "USD",
    scale: 1,
    period_kind: fiscal_period === "FY" ? "fiscal_y" : "fiscal_q",
    fiscal_year,
    fiscal_period,
    as_of: AS_OF,
    source_id: SOURCE_ID,
    coverage_level: "full",
    ...overrides,
  };
}

function verifierFacts(facts: ReadonlyArray<IssuerFundamentalFact>): VerifierFact[] {
  return facts.map((f) => ({
    fact_id: f.fact_id,
    source_id: f.source_id,
    unit: "currency",
    ...dates.get(f.fact_id)!,
    as_of: AS_OF,
    fiscal_year: f.fiscal_year,
    fiscal_period: f.fiscal_period,
  }));
}

// NVDA's FY2026 figures, as ingested (sec-edgar.test.ts).
const Q4 = { period_kind: "fiscal_q", period_start: "2025-10-27", period_end: "2026-01-25" };
const Q3 = { period_kind: "fiscal_q", period_start: "2025-07-28", period_end: "2025-10-26" };
const FY = { period_kind: "fiscal_y", period_start: "2025-01-27", period_end: "2026-01-25" };
const point = (period_end: string) => ({ period_kind: "point", period_start: null, period_end });

function nvdaFacts() {
  return [
    fact("operating_cash_flow", 2026, "Q3", 23_751e6, Q3),
    fact("capex", 2026, "Q3", 1_636e6, Q3),
    fact("operating_cash_flow", 2026, "Q4", 36_188e6, Q4),
    fact("capex", 2026, "Q4", 1_284e6, Q4, { source_id: CAPEX_SOURCE_ID }),
    fact("operating_cash_flow", 2026, "FY", 102_718e6, FY),
    fact("capex", 2026, "FY", 6_042e6, FY),
    fact("eps_diluted", 2026, "Q4", 1.76, Q4),
    fact("eps_diluted", 2026, "Q3", 1.3, Q3),
    fact("total_assets", 2026, "FY", 161_148e6, point("2025-10-26")),
    fact("total_assets", 2026, "FY", 206_803e6, point("2026-01-25")),
    fact("cash_and_equivalents", 2026, "FY", 10_605e6, point("2026-01-25")),
    fact("total_liabilities", 2026, "FY", 49_510e6, point("2026-01-25")),
    fact("total_equity", 2026, "FY", 157_293e6, point("2026-01-25")),
  ];
}

// Free cash flow as loadStatementBlocks mints it: one derived fact per spec.
function minted(specs: ReturnType<typeof freeCashFlowSpecs>): DerivedQuarterFact[] {
  return specs.map((spec, index) => {
    const fact_id = `d0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    return {
      ...spec,
      fact_id,
      binding: { fact_id, source_id: spec.source_id, unit: "currency", ...spec.period, as_of: AS_OF },
    };
  });
}

function blocksFor(facts = nvdaFacts(), facets: StatementFacets = ALL) {
  const verifier = verifierFacts(facts);
  return buildStatementBlocks({
    facts,
    verifierFacts: verifier,
    derived: minted(freeCashFlowSpecs(facts, verifier)),
    facets,
    snapshotId: SNAPSHOT_ID,
    asOf: AS_OF,
  });
}

type Item = { label: string; value_ref: string; format: string };
const items = (block: Record<string, unknown>) => block.items as Item[];

test("free cash flow is operating cash flow less capex for the latest quarter and year, in its currency", () => {
  const facts = nvdaFacts();
  const specs = freeCashFlowSpecs(facts, verifierFacts(facts));
  assert.deepEqual(specs.map((spec) => [spec.period.fiscal_period, spec.value_num, spec.currency, spec.period.period_end]), [
    ["Q4", 34_904e6, "USD", "2026-01-25"],
    ["FY", 96_676e6, "USD", "2026-01-25"],
  ]);
  const q4 = specs[0]!;
  assert.equal(q4.metric, "free_cash_flow");
  assert.equal(q4.unit, "currency");
  assert.deepEqual(q4.input_fact_ids, [facts[2]!.fact_id, facts[3]!.fact_id]);
});

test("free cash flow is not computed across different dates, currencies or without capex", () => {
  const shifted = [
    fact("operating_cash_flow", 2026, "Q4", 36_188e6, Q4),
    fact("capex", 2026, "Q4", 1_284e6, { ...Q4, period_start: "2025-08-01" }),
  ];
  assert.deepEqual(freeCashFlowSpecs(shifted, verifierFacts(shifted)), []);
  const currencies = [
    fact("operating_cash_flow", 2026, "Q4", 36_188e6, Q4),
    fact("capex", 2026, "Q4", 1_284e6, Q4, { currency: "EUR" }),
  ];
  assert.deepEqual(freeCashFlowSpecs(currencies, verifierFacts(currencies)), []);
  const alone = [fact("operating_cash_flow", 2026, "Q4", 36_188e6, Q4)];
  assert.deepEqual(freeCashFlowSpecs(alone, verifierFacts(alone)), []);
});

test("cash flow shows the latest quarter and fiscal year, free cash flow citing both inputs and their sources", () => {
  const [quarter, year] = blocksFor(undefined, { cashFlow: true, balanceSheet: false, eps: false, epsBasic: false });
  assert.equal(quarter!.title, "Cash flow (Q4 2026)");
  assert.deepEqual(items(quarter!).map((item) => [item.label, item.format]), [
    ["Operating cash flow", "$36.2B"],
    ["Capital expenditures", "$1.3B"],
    ["Free cash flow", "$34.9B"],
  ]);
  assert.equal(year!.title, "Cash flow (FY2026)");
  assert.deepEqual(items(year!).map((item) => item.format), ["$102.7B", "$6.0B", "$96.7B"]);
  // Every value is bound for the seal, and capex's filing is among the block's sources.
  const bindings = (quarter!.data_ref as { params: { fact_bindings: Array<{ fact_id: string }> } }).params.fact_bindings;
  assert.deepEqual(new Set(bindings.map((binding) => binding.fact_id)), new Set(items(quarter!).map((item) => item.value_ref)));
  assert.deepEqual([...(quarter!.source_refs as string[])].sort(), [SOURCE_ID, CAPEX_SOURCE_ID]);
  assert.notEqual(quarter!.id, year!.id);
});

test("free cash flow is shown for the latest period that has both inputs", () => {
  // Q4 reports operating cash flow but not capex; Q3 reports both.
  const facts = [
    fact("operating_cash_flow", 2026, "Q3", 23_751e6, Q3),
    fact("capex", 2026, "Q3", 1_636e6, Q3),
    fact("operating_cash_flow", 2026, "Q4", 36_188e6, Q4),
  ];
  const specs = freeCashFlowSpecs(facts, verifierFacts(facts));
  assert.deepEqual(specs.map((spec) => [spec.period.fiscal_period, spec.value_num]), [["Q3", 22_115e6]]);
  const [quarter] = blocksFor(facts, { cashFlow: true, balanceSheet: false, eps: false, items: ["free_cash_flow"] });
  assert.equal(quarter!.title, "Cash flow (Q3 2026)");
  assert.deepEqual(items(quarter!).map((item) => item.label), ["Operating cash flow", "Capital expenditures", "Free cash flow"]);
  // Operating cash flow alone still reads its latest quarter.
  const [ocfOnly] = blocksFor(facts, { cashFlow: true, balanceSheet: false, eps: false, items: ["operating_cash_flow"] });
  assert.equal(ocfOnly!.title, "Cash flow (Q4 2026)");
});

test("without operating cash flow, cash flow shows capex alone and no free cash flow", () => {
  const facts = [fact("capex", 2026, "Q4", 1_284e6, Q4)];
  const verifier = verifierFacts(facts);
  assert.deepEqual(freeCashFlowSpecs(facts, verifier), []);
  const [quarter] = blocksFor(facts, { cashFlow: true, balanceSheet: false, eps: false, epsBasic: false });
  assert.equal(quarter!.title, "Cash flow (Q4 2026)");
  assert.deepEqual(items(quarter!).map((item) => [item.label, item.format]), [["Capital expenditures", "$1.3B"]]);
});

test("without capex, cash flow shows operating cash flow alone and no free cash flow", () => {
  const facts = [fact("operating_cash_flow", 2026, "Q4", 36_188e6, Q4)];
  const [quarter] = blocksFor(facts, { cashFlow: true, balanceSheet: false, eps: false, epsBasic: false });
  assert.deepEqual(items(quarter!).map((item) => item.label), ["Operating cash flow"]);
});

test("the balance sheet shows its latest period end, dated by month, never as a fiscal year", () => {
  const blocks = blocksFor(undefined, { cashFlow: false, balanceSheet: true, eps: false });
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.title, "Balance sheet (Jan 2026)");
  assert.deepEqual(items(blocks[0]!).map((item) => [item.label, item.format]), [
    ["Cash and equivalents", "$10.6B"],
    ["Total assets", "$206.8B"],
    ["Total liabilities", "$49.5B"],
    ["Stockholders' equity", "$157.3B"],
  ]);
  // The model reads a balance as a point at its date (its "FY" label is no quarter).
  const figure = displayedFigures(blocks).find((candidate) => candidate.metric === "Total assets");
  assert.equal(figure?.period, "balance at period end");
  assert.equal(figure?.period_end, "2026-01-25");
});

test("EPS shows the latest quarter's diluted EPS to the cent", () => {
  const blocks = blocksFor(undefined, { cashFlow: false, balanceSheet: false, eps: true, epsBasic: false });
  assert.equal(blocks[0]!.title, "Earnings per share (Q4 2026)");
  assert.deepEqual(items(blocks[0]!).map((item) => [item.label, item.format]), [["EPS (diluted)", "$1.76"]]);
});

test("a block shows the statement items asked for, and a dropped item stays dropped", () => {
  const ask = (question: string, read: ScopeProposal, prior: ResearchScope | null = null) =>
    resolveResearchScope({ companies: [NVDA], prior, asOf: AS_OF, proposal: read });
  const labels = (scope: ResearchScope) => blocksFor(undefined, statementFacets(scope)).flatMap(items).map((item) => item.label);

  const ocf = ask("Show NVDA's operating cash flow", proposal({ metrics: ["operating_cash_flow"] }));
  assert.deepEqual(labels(ocf), ["Operating cash flow", "Operating cash flow"]);
  assert.deepEqual(labels(ask("Drop capex", proposal({ offMetrics: ["capex"] }), ocf)), ["Operating cash flow", "Operating cash flow"]);
  // Free cash flow comes with the two figures it is computed from.
  assert.deepEqual(labels(ask("What is NVDA's free cash flow?", proposal({ metrics: ["free_cash_flow"] }))).slice(0, 3), ["Operating cash flow", "Capital expenditures", "Free cash flow"]);

  const balance = ask("Show NVDA's balance sheet", proposal({ metrics: ["balance_sheet"] }));
  assert.deepEqual(labels(balance), ["Cash and equivalents", "Total assets", "Total liabilities", "Stockholders' equity"]);
  assert.deepEqual(labels(ask("Drop total assets", proposal({ offMetrics: ["total_assets"] }), balance)), ["Cash and equivalents", "Total liabilities", "Stockholders' equity"]);
  assert.deepEqual(labels(ask("How much cash does NVDA have?", proposal({ metrics: ["cash_and_equivalents"] }))), ["Cash and equivalents"]);
});

test("basic EPS asked for shows basic EPS, not diluted", () => {
  const scope = resolveResearchScope({ companies: [NVDA], prior: null, asOf: AS_OF, proposal: proposal({ metrics: ["eps_basic"] }) });
  const facts = [
    fact("eps_diluted", 2026, "Q4", 1.76, Q4),
    fact("eps_basic", 2026, "Q4", 1.77, Q4),
  ];
  const [block] = blocksFor(facts, statementFacets(scope));
  assert.equal(block!.title, "Earnings per share (Q4 2026)");
  assert.deepEqual(items(block!).map((item) => [item.label, item.format]), [["EPS (basic)", "$1.77"]]);
  // Both asked for: both shown, for the same period.
  const both = statementFacets(resolveResearchScope({ companies: [NVDA], prior: null, asOf: AS_OF, proposal: proposal({ metrics: ["eps_basic", "eps_diluted"] }) }));
  assert.deepEqual(items(blocksFor(facts, both)[0]!).map((item) => item.label), ["EPS (diluted)", "EPS (basic)"]);
});

test("once the annual report is in, the year's EPS is the latest (no fourth quarter EPS is derived)", () => {
  const facts = [
    fact("eps_diluted", 2026, "Q3", 1.3, Q3),
    fact("eps_diluted", 2026, "FY", 4.9, FY),
  ];
  const [block] = blocksFor(facts, { cashFlow: false, balanceSheet: false, eps: true, epsBasic: false });
  assert.equal(block!.title, "Earnings per share (FY2026)");
  assert.deepEqual(items(block!).map((item) => item.format), ["$4.90"]);
});

test("a fiscal year the question names limits every figure to that year", () => {
  const FY25 = { period_kind: "fiscal_y", period_start: "2024-01-29", period_end: "2025-01-26" };
  const facts = [
    ...nvdaFacts(),
    fact("operating_cash_flow", 2025, "FY", 64_089e6, FY25),
    fact("capex", 2025, "FY", 3_236e6, FY25),
    fact("total_assets", 2025, "FY", 111_601e6, point("2025-01-26")),
  ];
  const verifier = verifierFacts(facts);
  const blocks = buildStatementBlocks({
    facts,
    verifierFacts: verifier,
    derived: minted(freeCashFlowSpecs(facts, verifier, 2025)),
    facets: ALL,
    fiscalYear: 2025,
    snapshotId: SNAPSHOT_ID,
    asOf: AS_OF,
  });
  assert.deepEqual(blocks.map((block) => block.title), ["Cash flow (FY2025)", "Balance sheet (Jan 2025)"]);
  assert.deepEqual(items(blocks[0]!).map((item) => item.format), ["$64.1B", "$3.2B", "$60.9B"]);
});

test("facts the verifier cannot load are left out rather than rendered unbound", () => {
  const facts = nvdaFacts();
  const verifier = verifierFacts(facts).filter((binding) => binding.fact_id !== facts[2]!.fact_id);
  const blocks = buildStatementBlocks({ facts, verifierFacts: verifier, facets: ALL, snapshotId: SNAPSHOT_ID, asOf: AS_OF });
  // Q4's operating cash flow cannot be bound, so free cash flow (asked for
  // with everything else) reads Q3, the latest quarter with both inputs bound.
  assert.equal(blocks[0]!.title, "Cash flow (Q3 2026)");
  assert.ok(!blocks.flatMap(items).some((item) => item.value_ref === facts[2]!.fact_id));
  assert.equal(freeCashFlowSpecs(facts, verifier).some((spec) => spec.period.fiscal_period === "Q4"), false);
  // Capex alone still reads Q4, the latest quarter it is bound for.
  const capexOnly = buildStatementBlocks({
    facts, verifierFacts: verifier, facets: { ...ALL, items: ["capex"] }, snapshotId: SNAPSHOT_ID, asOf: AS_OF,
  });
  assert.equal(capexOnly[0]!.title, "Cash flow (Q4 2026)");
});

test("a figure derived across filings cites every filing it was computed from", async (t) => {
  const [quarter] = blocksFor(undefined, { cashFlow: true, balanceSheet: false, eps: false, epsBasic: false });
  const ocfId = items(quarter!)[0]!.value_ref;
  const Q3_FILING = "00000000-0000-4000-a000-000000000003";
  const query = fakeQuery((_text, values) => ({
    rows: ((values?.[0] ?? []) as string[]).map((fact_id) => ({
      fact_id,
      quality_flags: fact_id === ocfId
        ? [{ kind: "sec_period_difference", input_source_ids: [SOURCE_ID, Q3_FILING] }]
        // A derived margin's lineage names facts, not filings: nothing to add.
        : [{ kind: "derivation", input_fact_ids: ["x"] }],
    })),
  }));
  const [withSources] = await withDerivationSources({ query } as never, [quarter!]);
  assert.deepEqual([...(withSources!.source_refs as string[])].sort(), [SOURCE_ID, CAPEX_SOURCE_ID, Q3_FILING].sort());

  // Unreadable lineage leaves the block as it was.
  t.mock.method(console, "warn", () => {});
  const failing = fakeQuery(() => { throw new Error("database unavailable"); });
  assert.deepEqual(await withDerivationSources({ query: failing } as never, [quarter!]), [quarter!]);
});

test("no statement facts means no blocks", () => {
  assert.deepEqual(blocksFor([], ALL), []);
});

test("a read failure costs only these blocks, and the reads are full-coverage at the cutoff", async (t) => {
  t.mock.method(console, "warn", () => {});
  const texts: string[] = [];
  const failing = fakeQuery((text) => {
    texts.push(text);
    throw new Error("database unavailable");
  });
  const issuer = { kind: "issuer" as const, id: NVDA.issuer_id };
  assert.deepEqual(await loadStatementBlocks({ query: failing } as never, { issuer, facets: ALL, snapshotId: SNAPSHOT_ID, asOf: AS_OF }), []);
  assert.ok(texts.length > 0);
  assert.ok(texts.every((text) => /f\.coverage_level = 'full'/.test(text)));
});

test("a turn's statement facets follow the metrics it names", () => {
  const facets = (question: string, read: ScopeProposal) => {
    const { items: _items, ...families } = statementFacets(resolveResearchScope({ companies: [NVDA], prior: null, asOf: AS_OF, proposal: read }));
    return families;
  };
  assert.deepEqual(facets("What is NVDA's free cash flow?", proposal({ metrics: ["free_cash_flow"] })), { cashFlow: true, balanceSheet: false, eps: false, epsBasic: false });
  assert.deepEqual(facets("Show NVDA's capex and balance sheet", proposal({ metrics: ["capex", "balance_sheet"] })), { cashFlow: true, balanceSheet: true, eps: false, epsBasic: false });
  assert.deepEqual(facets("What was NVDA's EPS?", proposal({ metrics: ["eps_diluted"] })), { cashFlow: false, balanceSheet: false, eps: true, epsBasic: false });
  assert.deepEqual(facets("Analyze NVDA", proposal()), { cashFlow: false, balanceSheet: false, eps: false, epsBasic: false });
});

test("a statement metric not shown, or asked of a comparison, is a named gap", () => {
  const scope = (question: string, companies: ResearchScope["companies"]) =>
    resolveResearchScope({ companies, prior: null, asOf: AS_OF, proposal: proposal({ metrics: ["free_cash_flow"] }) });
  const input = { snapshotId: SNAPSHOT_ID, asOf: AS_OF };
  const notes = (blocks: ReadonlyArray<Record<string, unknown>>) =>
    blocks.map((block) => (block.segments as Array<{ text: string }>)[0]!.text);

  const single = scope("What is NVDA's free cash flow?", [NVDA]);
  assert.deepEqual(notes(scopeGapBlocks(single, blocksFor(), input)), []);
  assert.deepEqual(notes(scopeGapBlocks(single, [], input)), [
    "Free cash flow is not available for NVDA in this data, so no other figure is shown in its place.",
  ]);
  const comparison = scope("Compare NVDA and AMD free cash flow", [NVDA, AMD]);
  assert.deepEqual(notes(scopeGapBlocks(comparison, [], input)), [
    "Free cash flow is shown for one company at a time; ask about one company for it.",
  ]);
});

test("a cash question with no cash figure is a named gap, never another balance in its place", () => {
  const scope = resolveResearchScope({ companies: [NVDA], prior: null, asOf: AS_OF, proposal: proposal({ metrics: ["cash_and_equivalents"] }) });
  assert.equal(scope.reads, "statements");
  // The filer reports assets but not the mapped cash concept.
  const facts = [fact("total_assets", 2026, "FY", 206_803e6, point("2026-01-25"))];
  const shown = blocksFor(facts, statementFacets(scope));
  assert.deepEqual(shown, []);
  const notes = scopeGapBlocks(scope, shown, { snapshotId: SNAPSHOT_ID, asOf: AS_OF })
    .map((block) => (block.segments as Array<{ text: string }>)[0]!.text);
  assert.deepEqual(notes, ["Cash and equivalents is not available for NVDA in this data, so no other figure is shown in its place."]);
  assert.equal(mayOfferOtherFacts(scope, shown), false);
});

test("a statement request offers other facts only when it shows what it asked for", () => {
  const scope = resolveResearchScope({ companies: [NVDA], prior: null, asOf: AS_OF, proposal: proposal({ metrics: ["free_cash_flow"] }) });
  assert.equal(scope.reads, "statements");
  assert.equal(mayOfferOtherFacts(scope, blocksFor()), true);
  assert.equal(mayOfferOtherFacts(scope, []), false);
});
