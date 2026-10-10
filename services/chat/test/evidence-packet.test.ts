import test from "node:test";
import assert from "node:assert/strict";

import { buildEvidencePacket, packetForModel } from "../src/evidence-packet.ts";
import { resolveResearchScope } from "../src/research-scope.ts";

const NVDA = { issuer_id: "60000000-0000-4000-8000-000000000001", label: "NVDA" };
const AMD = { issuer_id: "60000000-0000-4000-8000-000000000002", label: "AMD" };
const AAPL = { issuer_id: "60000000-0000-4000-8000-000000000003", label: "AAPL" };
const CUTOFF = "2026-09-01T00:00:00.000Z";
const scope = (question: string, companies = [NVDA]) =>
  resolveResearchScope({ question, companies, prior: null, asOf: CUTOFF });

const LATEST = {
  id: "b-latest",
  kind: "metric_row",
  title: "Latest quarter (Q4 2026)",
  source_refs: ["s-10q"],
  items: [
    { label: "Revenue", format: "$62.1B", value_ref: "f-rev" },
    { label: "Gross margin", format: "74.4%", value_ref: "f-gm" },
  ],
};
const BARS = {
  id: "b-bars",
  kind: "revenue_bars",
  title: "Quarterly revenue",
  source_refs: ["s-10q", "s-10k"],
  bars: [{ label: "Q3 2026", format: "$57.0B", value_ref: "f-q3" }, { label: "Q4 2026", format: "$62.1B", value_ref: "f-rev" }],
};

test("a quarterly packet holds only its figures, each with a packet id, its fact, sources and format (#207)", () => {
  const packet = buildEvidencePacket({ scope: scope("Analyze NVDA's latest quarter"), factBlocks: [LATEST, BARS], cutoff: CUTOFF });
  assert.equal(packet.route, "latest_quarter");
  assert.equal(packet.cutoff, CUTOFF);
  assert.deepEqual(packet.figures.map((figure) => [figure.id, figure.metric, figure.period ?? null, figure.value, figure.fact_id, figure.source_ids]), [
    ["F1", "Revenue", null, "$62.1B", "f-rev", ["s-10q"]],
    ["F2", "Gross margin", null, "74.4%", "f-gm", ["s-10q"]],
    ["F3", "Revenue", "Q3 2026", "$57.0B", "f-q3", ["s-10q", "s-10k"]],
    ["F4", "Revenue", "Q4 2026", "$62.1B", "f-rev", ["s-10q", "s-10k"]],
  ]);
  assert.deepEqual(packet.coverage, [{ company: "NVDA", status: "shown" }]);
  assert.deepEqual(packet.query_bounds, { periods: "latest quarter, with revenue for the last 8 quarters" });
});

test("a comparison packet binds each figure to its company and period; a company with none is a named gap (#207)", () => {
  const comparison = {
    id: "b-cmp",
    kind: "metrics_comparison",
    title: "Side by side (fiscal 2025)",
    subject_labels: ["NVDA", "AMD"],
    metrics: ["Revenue"],
    source_refs: ["s-nvda", "s-amd"],
    cells: [[{ value_ref: "f-n", format: "$130.5B" }], [{ value_ref: "f-a", format: "$25.8B" }]],
    data_ref: { params: { fact_bindings: [
      { fact_id: "f-n", fiscal_year: 2025, fiscal_period: "FY", period_end: "2025-01-26" },
      { fact_id: "f-a", fiscal_year: 2025, fiscal_period: "FY", period_end: "2025-12-27" },
    ] } },
  };
  const packet = buildEvidencePacket({
    scope: scope("Compare NVDA, AMD and AAPL fiscal 2025 revenue", [NVDA, AMD, AAPL]),
    factBlocks: [comparison],
    cutoff: CUTOFF,
  });
  assert.deepEqual(packet.figures.map((figure) => [figure.company, figure.period, figure.period_end, figure.fact_id]), [
    ["NVDA", "FY2025", "2025-01-26", "f-n"],
    ["AMD", "FY2025", "2025-12-27", "f-a"],
  ]);
  assert.deepEqual(packet.coverage, [
    { company: "NVDA", status: "shown" },
    { company: "AMD", status: "shown" },
    { company: "AAPL", status: "not_shown" },
  ]);
  assert.deepEqual(packet.query_bounds, { periods: "fiscal year 2025 per company" });
});

test("missing cash flow is a gap with no figure in its place (#207)", () => {
  const gap = { id: "b-gap", kind: "rich_text", segments: [{ type: "text", text: "Free cash flow is not available for AMD in this data, so no other figure is shown in its place." }] };
  const packet = buildEvidencePacket({ scope: scope("What is AMD's free cash flow?", [AMD]), factBlocks: [gap], cutoff: CUTOFF });
  assert.equal(packet.route, "unavailable_metric");
  assert.deepEqual(packet.figures, []);
  assert.deepEqual(packet.gaps, [gap.segments[0]!.text]);
  assert.deepEqual(packet.coverage, [{ company: "AMD", status: "not_shown" }]);
  assert.deepEqual(packet.query_bounds, {});
});

test("an inherited YTD window is bounded at its own cutoff (#207)", () => {
  const first = scope("Compare NVDA with AMD YTD", [NVDA, AMD]);
  const next = resolveResearchScope({ question: "Explain the differences", companies: [NVDA, AMD], prior: first, asOf: "2026-09-05T00:00:00.000Z" });
  const packet = buildEvidencePacket({ scope: next, factBlocks: [], cutoff: "2026-09-05T00:00:00.000Z" });
  assert.equal(packet.query_bounds.price_window, "year to date, to the 2026-09-01 cutoff");
});

test("the model's packet has short ids only, no fact or source ids (#207)", () => {
  const model = JSON.stringify(packetForModel(buildEvidencePacket({ scope: scope("Analyze NVDA"), factBlocks: [LATEST], cutoff: CUTOFF })));
  assert.match(model, /"id":"F1"/);
  for (const absent of ["fact_id", "f-rev", "source_ids", "s-10q", "block_id", "b-latest"]) assert.ok(!model.includes(absent), absent);
});

test("an auto-selected peer with no block is still covered, as not shown (#207)", () => {
  // A peers request's auto-selected peer carries no label, and the comparison
  // and price readers came back empty.
  const peers = { ...scope("How does NVDA compare with its peers?"), companies: [NVDA, { issuer_id: AMD.issuer_id }] };
  const packet = buildEvidencePacket({ scope: peers, factBlocks: [], cutoff: CUTOFF });
  assert.deepEqual(packet.coverage, [
    { company: "NVDA", status: "not_shown" },
    { company: "issuer:60000000", status: "not_shown" },
  ]);
});

test("a single company's figures carry the period and end date their facts are bound to (#207)", () => {
  const bound = (block: Record<string, unknown>, bindings: unknown[]) => ({ ...block, data_ref: { params: { fact_bindings: bindings } } });
  const packet = buildEvidencePacket({
    scope: scope("Analyze NVDA's latest quarter"),
    factBlocks: [
      bound(LATEST, [
        { fact_id: "f-rev", fiscal_year: 2026, fiscal_period: "Q4", period_end: "2026-01-25" },
        { fact_id: "f-gm", fiscal_year: 2026, fiscal_period: "Q4", period_end: "2026-01-25" },
      ]),
      bound(BARS, [{ fact_id: "f-q3", fiscal_year: 2026, fiscal_period: "Q3", period_end: "2025-10-26" }]),
    ],
    cutoff: CUTOFF,
  });
  assert.deepEqual(packet.figures.map((figure) => [figure.id, figure.period ?? null, figure.period_end ?? null]), [
    ["F1", "Q42026", "2026-01-25"],
    ["F2", "Q42026", "2026-01-25"],
    // A bar keeps its quarter label and gains the end date of the fact it cites.
    ["F3", "Q3 2026", "2025-10-26"],
    ["F4", "Q4 2026", null],
  ]);
});
