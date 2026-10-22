import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { checkAssertions } from "../src/assertions.ts";
import { buildEvidencePacket, claimSelection, packetForModel, type ClaimRecord } from "../src/evidence-packet.ts";
import { plainText, renderAssertion } from "../src/render-assertions.ts";
import { resolveResearchScope, type ScopeProposal } from "../src/research-scope.ts";
import { proposal } from "./scope-fixtures.ts";

const NVDA = { issuer_id: "60000000-0000-4000-8000-000000000001", label: "NVDA" };
const AMD = { issuer_id: "60000000-0000-4000-8000-000000000002", label: "AMD" };
const AAPL = { issuer_id: "60000000-0000-4000-8000-000000000003", label: "AAPL" };
const CUTOFF = "2026-09-01T00:00:00.000Z";
const scope = (question: string, companies = [NVDA], read: ScopeProposal = proposal()) =>
  resolveResearchScope({ question, companies, prior: null, asOf: CUTOFF, proposal: read });
const REVENUE = { metrics: ["income_statement"], items: ["revenue"] } as const;
const GROSS_MARGIN_CHANGE = proposal({ asks: ["margins", "margin_trend"], metrics: ["income_statement"], items: ["gross_margin"] });

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

test("with no figure shown, the turn's other values are its figures, while its company stays not shown (#302)", () => {
  const revenue = {
    metric: "Revenue", period: "FY2025", value: "$416.2B", fact_id: "f-aapl", source_ids: ["s-facts"], displayed: false as const,
    binding: { fact_id: "f-aapl", unit: "currency", period_kind: "fiscal_y", fiscal_year: 2025 },
  };
  const packet = buildEvidencePacket({ scope: scope("Analyze AAPL", [AAPL]), factBlocks: [], available: [revenue], cutoff: CUTOFF });
  assert.deepEqual([packet.figures, packet.coverage], [[{ id: "F1", ...revenue }], [{ company: "AAPL", status: "not_shown" }]]);
  // The model sees it marked as in no block, without its fact, source or binding.
  assert.deepEqual(packetForModel(packet).figures, [{ id: "F1", metric: "Revenue", period: "FY2025", value: "$416.2B", displayed: false }]);
  // A turn whose blocks show a figure references only those.
  const shown = buildEvidencePacket({ scope: scope("Analyze NVDA's latest quarter"), factBlocks: [LATEST], available: [revenue], cutoff: CUTOFF });
  assert.deepEqual([shown.figures.map((figure) => figure.fact_id), shown.coverage], [["f-rev", "f-gm"], [{ company: "NVDA", status: "shown" }]]);
});

test("with no figure shown in a comparison, the turn's other values are its primary company's (#302 review)", () => {
  const price = { metric: "Price", value: "$180.00", source_ids: [], displayed: false as const };
  const packet = buildEvidencePacket({ scope: scope("Compare NVDA with AMD", [NVDA, AMD]), factBlocks: [], available: [price], cutoff: CUTOFF });
  assert.deepEqual(packet.figures, [{ id: "F1", ...price, company: "NVDA" }]);
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
    scope: scope("Compare NVDA, AMD and AAPL fiscal 2025 revenue", [NVDA, AMD, AAPL], proposal(REVENUE)),
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

test("a metric no reader serves is a gap with no figure in its place (#207)", () => {
  const gap = { id: "b-gap", kind: "rich_text", segments: [{ type: "text", text: "EBITDA is not available for AMD in this data, so no other figure is shown in its place." }] };
  const packet = buildEvidencePacket({ scope: scope("What is AMD's EBITDA?", [AMD], proposal({ metrics: ["ebitda"] })), factBlocks: [gap], cutoff: CUTOFF });
  assert.equal(packet.route, "unavailable_metric");
  assert.deepEqual(packet.figures, []);
  assert.deepEqual(packet.gaps, [gap.segments[0]!.text]);
  assert.deepEqual(packet.coverage, [{ company: "AMD", status: "not_shown" }]);
  assert.deepEqual(packet.query_bounds, {});
});

test("a cash flow question names the periods its readers cover", () => {
  const packet = buildEvidencePacket({ scope: scope("What is AMD's free cash flow?", [AMD], proposal({ metrics: ["free_cash_flow"] })), factBlocks: [], cutoff: CUTOFF });
  assert.equal(packet.route, "statements");
  assert.equal(
    packet.query_bounds.periods,
    "latest quarter and latest fiscal year reported for cash flow; balance sheet at its latest period end; EPS for the latest quarter, or the fiscal year once its annual report is in",
  );
  // A named fiscal year is the only period read.
  const year = buildEvidencePacket({ scope: scope("What was AMD's free cash flow in fiscal 2024?", [AMD], proposal({ metrics: ["free_cash_flow"] })), factBlocks: [], cutoff: CUTOFF });
  assert.equal(
    year.query_bounds.periods,
    "fiscal year 2024 only: its latest quarter and the year for cash flow; balance sheet at its latest period end in that year; EPS for that year",
  );
});

test("an inherited YTD window is bounded at its own cutoff (#207)", () => {
  const first = scope("Compare NVDA with AMD YTD", [NVDA, AMD]);
  const next = resolveResearchScope({
    question: "Explain the differences",
    companies: [NVDA, AMD],
    prior: first,
    asOf: "2026-09-05T00:00:00.000Z",
    proposal: proposal({ asks: ["explains"] }),
  });
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
  const peers = { ...scope("How does NVDA compare with its peers?", [NVDA], proposal({ asks: ["peers"] })), companies: [NVDA, { issuer_id: AMD.issuer_id }] };
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

const claim = (id: string, overrides: Partial<ClaimRecord>): ClaimRecord => ({
  claim_id: id,
  source_id: `s-${id}`,
  text_canonical: `Claim ${id}.`,
  predicate: "guidance.change",
  polarity: "neutral",
  effective_time: "2026-05-01T00:00:00.000Z",
  published_at: "2026-05-02T00:00:00.000Z",
  subject_id: NVDA.issuer_id,
  ...overrides,
});

test("a route reads its predicate families first, from the start of the period it covers (#207)", () => {
  // Management's own explanations come first on every route: they are the only
  // causes an answer may state.
  assert.deepEqual(claimSelection(scope("Analyze NVDA's latest quarter"), CUTOFF), {
    predicate_prefixes: ["management.explanation.", "guidance.", "kpi."],
    effective_from: "2024-09-01T00:00:00.000Z",
    effective_until: null,
    fiscal_year: null,
  });
  assert.deepEqual(claimSelection(scope("Break down NVDA's segments", [NVDA], proposal({ asks: ["segments"] })), CUTOFF).predicate_prefixes, ["management.explanation.", "segment.", "guidance."]);
  // Management's explanation of what the question asks about comes before its
  // other explanations: one release can hold more than the claim limit. The
  // margin named comes first; the others share one priority after it, so none
  // crowds out another.
  const MARGINS = ["management.explanation.gross_margin", "management.explanation.operating_income", "management.explanation.net_income"];
  assert.deepEqual(claimSelection(scope("What changed in NVDA's gross margin in Q1 fiscal 2026?", [NVDA], GROSS_MARGIN_CHANGE), CUTOFF).predicate_prefixes, [
    "management.explanation.gross_margin",
    MARGINS,
    "management.explanation.",
    "guidance.",
    "kpi.",
  ]);
  // A release explains an operating margin by its operating income (#425).
  assert.deepEqual(claimSelection(scope("What changed in NVDA's operating margin?", [NVDA], proposal({ asks: ["margins", "margin_trend"], metrics: ["income_statement"], items: ["operating_margin"] })), CUTOFF).predicate_prefixes.slice(0, 2), [
    "management.explanation.operating_income",
    MARGINS,
  ]);
  // Free cash flow's own explanations, then either component's alike.
  assert.deepEqual(claimSelection(scope("What is NVDA's free cash flow?", [NVDA], proposal({ metrics: ["free_cash_flow"] })), CUTOFF).predicate_prefixes.slice(0, 3), [
    "management.explanation.free_cash_flow",
    ["management.explanation.operating_cash_flow", "management.explanation.capex"],
    "management.explanation.",
  ]);
  // A question asking for guidance reads it first: for the metric it names,
  // then any. Whatever the figures' route, a metric no reader serves included:
  // guidance is how management answers it.
  assert.equal(scope("What adjusted EPS guidance did NVDA give?", [NVDA], proposal({ asks: ["guidance"], metrics: [{ metric: "eps_diluted", adjustment: "adjusted" }] })).reads, "unavailable_metric");
  // A question asking why as well ("why ..., and what guidance?") reads
  // management's explanation of the same metric at guidance's priority.
  assert.deepEqual(claimSelection(scope("What adjusted EPS guidance did NVDA give?", [NVDA], proposal({ asks: ["guidance"], metrics: [{ metric: "eps_diluted", adjustment: "adjusted" }] })), CUTOFF).predicate_prefixes.slice(0, 2), ["guidance.eps", "guidance."]);
  // The income-statement item it names before the rest of the statement.
  // Revenue's include its segments' and products' ("other" in a release).
  assert.deepEqual(claimSelection(scope("What revenue guidance did NVDA give?", [NVDA], proposal({ asks: ["guidance"], ...REVENUE })), CUTOFF).predicate_prefixes.slice(0, 3), [
    ["guidance.revenue", "guidance.other"],
    ["guidance.revenue", "guidance.gross_margin", "guidance.operating_expenses", "guidance.operating_income", "guidance.net_income"],
    "guidance.",
  ]);
  assert.deepEqual(claimSelection(scope("Why did NVDA's revenue decline, and what guidance did management give?", [NVDA], proposal({ asks: ["explains", "guidance"], ...REVENUE })), CUTOFF).predicate_prefixes[0], [
    "guidance.revenue",
    "guidance.other",
    "management.explanation.revenue",
    "management.explanation.other",
  ]);
  assert.equal(claimSelection(scope("What is NVDA's outlook for next quarter?", [NVDA], proposal({ asks: ["guidance"] })), CUTOFF).predicate_prefixes[0], "guidance.");
  assert.ok(!claimSelection(scope("What was NVDA's revenue?", [NVDA], proposal(REVENUE)), CUTOFF).predicate_prefixes.flat()[0]!.startsWith("guidance."));
  assert.equal(claimSelection(scope("What was NVDA's EPS?", [NVDA], proposal({ metrics: ["eps_diluted"] })), CUTOFF).predicate_prefixes[0], "management.explanation.eps");
  // An adjusted income figure names neither by itself; the items the question
  // names come first.
  assert.deepEqual(claimSelection(scope("Why did NVDA's revenue and adjusted operating income rise?", [NVDA], proposal({ asks: ["explains"], metrics: ["non_gaap_income", "income_statement"], items: ["revenue", "operating_income"] })), CUTOFF).predicate_prefixes[0], [
    "management.explanation.revenue",
    "management.explanation.operating_income",
    "management.explanation.net_income",
    "management.explanation.other",
  ]);
  // So does each metric it asks about: free cash flow's explanations never
  // crowd out EPS's; their components follow.
  assert.deepEqual(claimSelection(scope("What were NVDA's free cash flow and EPS?", [NVDA], proposal({ metrics: ["free_cash_flow", "eps_diluted"] })), CUTOFF).predicate_prefixes.slice(0, 2), [
    ["management.explanation.free_cash_flow", "management.explanation.eps"],
    ["management.explanation.operating_cash_flow", "management.explanation.capex"],
  ]);
  // A metric no reader serves is still explained by management, first.
  assert.equal(scope("Why did NVDA's adjusted operating income decline?", [NVDA], proposal({ asks: ["explains"], metrics: ["non_gaap_income"], items: ["operating_income"] })).reads, "unavailable_metric");
  assert.deepEqual(claimSelection(scope("Why did NVDA's adjusted operating income decline?", [NVDA], proposal({ asks: ["explains"], metrics: ["non_gaap_income"], items: ["operating_income"] })), CUTOFF).predicate_prefixes[0], [
    "management.explanation.operating_income",
    "management.explanation.net_income",
  ]);
  // One no explanation maps to (EBITDA: "other" in a release) reads them all.
  assert.equal(scope("Why did NVDA's EBITDA decline?", [NVDA], proposal({ asks: ["explains"], metrics: ["ebitda"] })).reads, "unavailable_metric");
  assert.equal(claimSelection(scope("Why did NVDA's EBITDA decline?", [NVDA], proposal({ asks: ["explains"], metrics: ["ebitda"] })), CUTOFF).predicate_prefixes[0], "management.explanation.");
  // Every item it names shares the top priority: none crowds out another.
  assert.deepEqual(claimSelection(scope("Why did NVDA's revenue fall while operating income rose?", [NVDA], proposal({ asks: ["explains"], metrics: ["income_statement"], items: ["revenue", "operating_income"] })), CUTOFF).predicate_prefixes[0], [
    "management.explanation.revenue",
    "management.explanation.operating_income",
    "management.explanation.other",
  ]);
  // A segment's revenue ("Gaming revenue") is explained as "other" in a release.
  assert.deepEqual(claimSelection(scope("Why did NVDA's Gaming revenue grow?", [NVDA], proposal({ asks: ["explains"], ...REVENUE })), CUTOFF).predicate_prefixes[0], [
    "management.explanation.revenue",
    "management.explanation.other",
  ]);
  // Operating or net income is read as the income statement: the item named
  // first, then its other explanations alike.
  assert.deepEqual(claimSelection(scope("Why did NVDA's operating income fall?", [NVDA], proposal({ asks: ["explains"], metrics: ["income_statement"], items: ["operating_income"] })), CUTOFF).predicate_prefixes.slice(0, 3), [
    "management.explanation.operating_income",
    [
      "management.explanation.revenue",
      "management.explanation.gross_margin",
      "management.explanation.operating_expenses",
      "management.explanation.operating_income",
      "management.explanation.net_income",
    ],
    "management.explanation.",
  ]);
  for (const [question, companies, read] of [
    ["How have NVDA's margins trended?", [NVDA], proposal({ asks: ["margins", "margin_trend"], metrics: ["income_statement"] })],
    ["What is NVDA's free cash flow?", [NVDA], proposal({ metrics: ["free_cash_flow"] })],
    ["Compare NVDA with AMD", [NVDA, AMD], proposal()],
  ] as const) {
    assert.ok(claimSelection(scope(question, [...companies], read), CUTOFF).predicate_prefixes.flat()[0]!.startsWith("management.explanation."), question);
  }
  // A fiscal year's window ends a quarter after the year, when its last release is out.
  const fiscal = claimSelection(scope("Compare NVDA with AMD for fiscal year 2025", [NVDA, AMD]), CUTOFF);
  assert.equal(fiscal.effective_from, "2024-01-01T00:00:00.000Z");
  assert.equal(fiscal.effective_until, "2026-04-01T00:00:00.000Z");
  // The issuer's own fiscal year bounds it where its facts date that year.
  assert.equal(fiscal.fiscal_year, 2025);
  assert.equal(claimSelection(scope("What changed in NVDA's gross margin in Q1 fiscal 2026?", [NVDA], GROSS_MARGIN_CHANGE), CUTOFF).effective_until, "2027-04-01T00:00:00.000Z");
  assert.deepEqual(claimSelection(undefined, CUTOFF), { predicate_prefixes: [], effective_from: null, effective_until: null, fiscal_year: null });
});

test("claims carry short ids, their company and a stance only their stored polarity gives (#207)", () => {
  const packet = buildEvidencePacket({
    scope: scope("Compare NVDA with AMD", [NVDA, AMD]),
    factBlocks: [],
    cutoff: CUTOFF,
    claims: {
      claims: [
        claim("a", { polarity: "positive" }),
        claim("b", { polarity: "negative", subject_id: AMD.issuer_id }),
        claim("c", { polarity: "mixed" }),
        claim("d", { polarity: "neutral", subject_id: undefined }),
      ],
      truncated: true,
    },
  });
  assert.deepEqual(packet.claims.map((entry) => [entry.id, entry.company ?? null, entry.stance, entry.claim_id]), [
    ["C1", "NVDA", "supporting", "a"],
    ["C2", "AMD", "challenging", "b"],
    ["C3", "NVDA", "unclassified", "c"],
    ["C4", null, "neutral", "d"],
  ]);
  assert.equal(packet.claims_truncated, true);
  assert.match(packet.query_bounds.claims!, /^management, guidance, and kpi claims from 2024-09-01 first, then the most recent others, published by the 2026-09-01 cutoff/);
  const forModel = packetForModel(packet);
  assert.equal(JSON.stringify(forModel).includes("s-a"), false, "no source ids reach the model");
  assert.equal(JSON.stringify(forModel).includes("\"claim_id\""), false, "no claim ids reach the model");
  assert.equal(forModel.claims_truncated, true);
});

test("only a stored contradiction is a disagreement; opposite directions, tone or another company are not (#207)", () => {
  const packet = buildEvidencePacket({
    factBlocks: [],
    cutoff: CUTOFF,
    claims: {
      claims: [
        // Raised revenue guidance and lowered EPS guidance can both be true.
        claim("raised-revenue", { polarity: "positive" }),
        claim("lowered-eps", { polarity: "negative", effective_time: "2026-06-15T00:00:00.000Z" }),
        claim("amd-lowered", { polarity: "negative", subject_id: AMD.issuer_id }),
        claim("upbeat", { predicate: "management.tone", polarity: "positive" }),
        claim("downbeat", { predicate: "management.tone", polarity: "negative" }),
        claim("backlog-up", { predicate: "kpi.commentary", polarity: "positive", effective_time: "2025-01-01T00:00:00.000Z" }),
        claim("backlog-down", { predicate: "kpi.commentary", polarity: "negative", effective_time: "2026-01-01T00:00:00.000Z" }),
      ],
      contradictions: [["backlog-up", "backlog-down"], ["backlog-up", "not-selected"]],
    },
  });
  assert.deepEqual(packet.disagreements, [
    { claims: ["C6", "C7"], basis: "a stored relation marks them as contradicting" },
  ]);
});

test("a failed claims read is unavailable, never none on file, and names nothing (#207)", () => {
  const packet = buildEvidencePacket({ factBlocks: [], cutoff: CUTOFF, claims: { claims: [], unavailable: true } });
  assert.equal(packet.claims_status, "unavailable");
  assert.deepEqual(packetForModel(packet), { route: "unknown", cutoff: CUTOFF, figures: [], query_bounds: packet.query_bounds, claims_status: "unavailable" });
  assert.equal(buildEvidencePacket({ factBlocks: [], cutoff: CUTOFF, claims: { claims: [] } }).claims_status, "none");
});

test("a stored contradiction listed in either order is one disagreement (#207)", () => {
  const packet = buildEvidencePacket({
    factBlocks: [],
    cutoff: CUTOFF,
    claims: {
      claims: [claim("raised", { polarity: "positive" }), claim("lowered", { polarity: "negative" })],
      contradictions: [["lowered", "raised"]],
    },
  });
  assert.deepEqual(packet.disagreements, [{ claims: ["C1", "C2"], basis: "a stored relation marks them as contradicting" }]);
});

test("a price window adds its event predicates to the route's, over the route's period (#207)", () => {
  const ytd = scope("Compare NVDA with AMD YTD", [NVDA, AMD]);
  assert.equal(ytd.reads, "comparison");
  assert.deepEqual(claimSelection(ytd, CUTOFF), {
    predicate_prefixes: ["management.explanation.", "guidance.", "kpi.", "material_event."],
    effective_from: "2024-09-01T00:00:00.000Z",
    effective_until: null,
    fiscal_year: null,
  });
});

test("an auto-selected peer's claims name it as coverage does, even with no figures (#207)", () => {
  const peer = "60000000-0000-4000-8000-0000000000ff";
  const base = scope("Compare NVDA with its peers", [NVDA], proposal({ asks: ["peers"] }));
  const packet = buildEvidencePacket({
    scope: { ...base, companies: [NVDA, { issuer_id: peer }] },
    factBlocks: [],
    cutoff: CUTOFF,
    claims: { claims: [claim("p", { subject_id: peer })] },
  });
  assert.ok(packet.coverage.some((entry) => entry.company === "issuer:60000000"));
  assert.equal(packet.claims[0]!.company, "issuer:60000000");
});

test("a named quarter's packet says which quarter was read, and reads claims from the year before it (#290)", () => {
  const named = scope("Why did AMD's operating margin turn negative in Q2 2025?", [AMD], proposal({ asks: ["explains", "margins"], metrics: ["income_statement"], items: ["operating_income"] }));
  const packet = buildEvidencePacket({ scope: named, factBlocks: [], cutoff: CUTOFF });
  assert.match(packet.query_bounds.periods!, /^fiscal Q2 2025/);
  assert.equal(claimSelection(named, CUTOFF).effective_from, "2024-01-01T00:00:00.000Z");
});

test("a price return carries its chart line's series and the chart's sources, and the model sees neither (#317)", () => {
  const NVDA_LINE = "d1000000-0000-4000-8000-000000000001";
  const AMD_LINE = "d1000000-0000-4000-8000-000000000002";
  const packet = buildEvidencePacket({
    cutoff: CUTOFF,
    factBlocks: [{
      id: "perf",
      kind: "perf_comparison",
      title: "Price return YTD 2026 (split-adjusted, excluding dividends)",
      default_range: "YTD 2026: 2025-12-31 close to 2026-08-31 close",
      data_ref: { kind: "perf_comparison", id: "perf", params: { series_refs: [NVDA_LINE, AMD_LINE] } },
      source_refs: ["s-px"],
      series: [
        { name: "NVDA", unit: "%", points: [{ x: "2025-12-31", y: 0 }, { x: "2026-08-31", y: 6.6 }] },
        { name: "AMD", unit: "%", points: [{ x: "2025-12-31", y: 0 }, { x: "2026-08-31", y: 3.58 }] },
      ],
    }],
  });
  assert.deepEqual(packet.figures.map((figure) => [figure.id, figure.company, figure.value, figure.series_ref, figure.source_ids]), [
    ["F1", "NVDA", "6.6%", NVDA_LINE, ["s-px"]],
    ["F2", "AMD", "3.58%", AMD_LINE, ["s-px"]],
  ]);
  const model = JSON.stringify(packetForModel(packet));
  assert.deepEqual([model.includes(NVDA_LINE), model.includes("s-px"), model.includes("\"6.6%\"")], [false, false, true]);
});

// The single-latest-quarter trace (NVDA, Q4 2026): its blocks and the packet its model was sent.
const TRACE = JSON.parse(readFileSync(new URL("./answer-lab/traces/single-latest-quarter.json", import.meta.url), "utf8"));
const TRACE_BLOCKS: Array<Record<string, any>> = TRACE.input.factBlocks;
const SENT = JSON.parse(TRACE.exchange.messages.find((message: { role: string }) => message.role === "user").content).evidence_packet;
const tracePacket = (factBlocks: ReadonlyArray<Record<string, unknown>>) =>
  buildEvidencePacket({ scope: TRACE.input.scope, factBlocks, cutoff: TRACE.input.cutoff });
const TRACE_SOURCE = "00000000-0000-4000-a000-000000000001";
// Q1 2025..Q4 2026 revenue, as the chart shows them.
const BAR_FACTS: string[] = TRACE_BLOCKS.find((block) => block.kind === "revenue_bars")!.bars.map((bar: { value_ref: string }) => bar.value_ref);
const QOQ_FACT = "5f91c1f3-8566-485a-ab62-f17503efebb9";

// Each other quarter's QoQ growth as the loader mints it from the golden revenue.
const seriesId = (i: number) => `d0000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
const SERIES = ([
  ["Q2", 2025, "2024-04-29", "2024-07-28", "15.3%"],
  ["Q3", 2025, "2024-07-29", "2024-10-27", "16.8%"],
  ["Q4", 2025, "2024-10-28", "2025-01-26", "12.1%"],
  ["Q1", 2026, "2025-01-27", "2025-04-27", "12.0%"],
  ["Q2", 2026, "2025-04-28", "2025-07-27", "6.1%"],
  ["Q3", 2026, "2025-07-28", "2025-10-26", "22.0%"],
] as const).map(([fiscal_period, fiscal_year, period_start, period_end, value], i) => ({
  record: { fact_id: seriesId(i), metric: "Revenue growth (QoQ)", period: `${fiscal_period} ${fiscal_year}`, period_end, value, of: [BAR_FACTS[i + 1], BAR_FACTS[i]] },
  binding: { fact_id: seriesId(i), unit: "ratio", period_kind: "fiscal_q", period_start, period_end, as_of: TRACE.input.cutoff, fiscal_year, fiscal_period },
}));

const derived = (id: string, period: string, period_end: string, value: string, fact_id: string, derived_from: [string, string]) =>
  ({ id, metric: "Revenue growth (QoQ)", period, period_end, value, fact_id, source_ids: [TRACE_SOURCE], derived_from });

// The trace's blocks with the series bound and cited on the revenue chart, and these records listed.
function withDerived(records: ReadonlyArray<unknown>) {
  return TRACE_BLOCKS.map((block) => block.kind !== "revenue_bars" ? block : {
    ...block,
    provenance_fact_refs: [...block.provenance_fact_refs, ...SERIES.map(({ record }) => record.fact_id)],
    data_ref: {
      ...block.data_ref,
      params: { ...block.data_ref.params, fact_bindings: [...block.data_ref.params.fact_bindings, ...SERIES.map(({ binding }) => binding)], derived_figures: records },
    },
  });
}

test("the trace's blocks give the packet its model was sent", () => {
  const sent = packetForModel(tracePacket(TRACE_BLOCKS));
  assert.deepEqual([sent.figures, sent.coverage], [SENT.figures, SENT.coverage]);
  assert.equal(SENT.figures.length, 17);
});

test("the chart's QoQ growth series follows every displayed figure, naming its operands by packet id", () => {
  const packet = tracePacket(withDerived(SERIES.map(({ record }) => record)));
  assert.deepEqual(packet.figures.slice(0, 17), tracePacket(TRACE_BLOCKS).figures);
  // F1 (the metric row) and F17 (the last bar) show Q4 2026's revenue; F8 is its QoQ.
  assert.deepEqual(["F1", "F8", "F10", "F11", "F17"].map((id) => {
    const figure = packet.figures.find((candidate) => candidate.id === id)!;
    return [id, figure.metric, figure.period, figure.value, figure.fact_id];
  }), [
    ["F1", "Revenue", "Q42026", "$62.1B", BAR_FACTS[7]],
    ["F8", "Revenue growth (QoQ)", "Q42026", "8.9%", QOQ_FACT],
    ["F10", "Revenue", "Q1 2025", "$26.0B", BAR_FACTS[0]],
    ["F11", "Revenue", "Q2 2025", "$30.0B", BAR_FACTS[1]],
    ["F17", "Revenue", "Q4 2026", "$62.1B", BAR_FACTS[7]],
  ]);
  assert.deepEqual(packet.figures.slice(17), [
    derived("F18", "Q2 2025", "2024-07-28", "15.3%", seriesId(0), ["F11", "F10"]),
    derived("F19", "Q3 2025", "2024-10-27", "16.8%", seriesId(1), ["F12", "F11"]),
    derived("F20", "Q4 2025", "2025-01-26", "12.1%", seriesId(2), ["F13", "F12"]),
    derived("F21", "Q1 2026", "2025-04-27", "12.0%", seriesId(3), ["F14", "F13"]),
    derived("F22", "Q2 2026", "2025-07-27", "6.1%", seriesId(4), ["F15", "F14"]),
    derived("F23", "Q3 2026", "2025-10-26", "22.0%", seriesId(5), ["F16", "F15"]),
  ]);
  assert.deepEqual(packet.coverage, [{ company: "NVDA", status: "shown" }]);
  // The model sees the operands, not the fact or its sources.
  assert.deepEqual((packetForModel(packet).figures as unknown[]).at(-1), {
    id: "F23", metric: "Revenue growth (QoQ)", period: "Q3 2026", period_end: "2025-10-26", value: "22.0%", derived_from: ["F16", "F15"],
  });
});

test("a derived record is a figure only when its own fact is not shown and both operands are, and only when well formed", () => {
  const [first, , , , , last] = SERIES.map(({ record }) => record);
  const records = [
    { ...first, of: [BAR_FACTS[1], "e0000000-0000-4000-8000-000000000001"] },
    { ...first, fact_id: QOQ_FACT },
    { ...first, of: [BAR_FACTS[1]] },
    { ...first, value: 0.153 },
    "15.3%",
    null,
    last,
  ];
  assert.deepEqual(tracePacket(withDerived(records)).figures.slice(17), [
    derived("F18", "Q3 2026", "2025-10-26", "22.0%", seriesId(5), ["F16", "F15"]),
  ]);
});

test("a derived figure names an operand by its figure in the record's own block, else by its first", () => {
  const record = { fact_id: "f-qoq", metric: "Revenue growth (QoQ)", period: "Q4 2026", period_end: "2026-01-25", value: "8.9%", of: ["f-rev", "f-q3"] };
  const carrying = (block: Record<string, unknown>) => ({ ...block, data_ref: { params: { derived_figures: [record] } } });
  const derivedOf = (factBlocks: ReadonlyArray<Record<string, unknown>>) =>
    buildEvidencePacket({ scope: scope("Analyze NVDA's latest quarter"), factBlocks, cutoff: CUTOFF }).figures.slice(4);
  const qoq = { id: "F5", metric: "Revenue growth (QoQ)", period: "Q4 2026", period_end: "2026-01-25", value: "8.9%", fact_id: "f-qoq" };
  // Q4 2026's revenue is the metric row's F1 and the chart's F4.
  assert.deepEqual(derivedOf([LATEST, carrying(BARS)]), [{ ...qoq, source_ids: ["s-10q", "s-10k"], derived_from: ["F4", "F3"] }]);
  // The metric row shows no Q3 2026: that operand is the chart's.
  assert.deepEqual(derivedOf([carrying(LATEST), BARS]), [{ ...qoq, source_ids: ["s-10q"], derived_from: ["F1", "F3"] }]);
});

test("a derived figure the answer cites seals as its fact, with the binding its chart carries", () => {
  const blocks = withDerived(SERIES.map(({ record }) => record));
  const packet = tracePacket(blocks);
  const report = checkAssertions([{ kind: "observation", text: "x", evidence: ["F23"] }], packet);
  assert.deepEqual(report.rejected, []);
  const rendered = renderAssertion(report.accepted[0]!, packet, blocks);
  assert.equal(plainText(rendered.segments), "NVDA's revenue growth (QoQ) was 22.0% in Q3 2026 (ended Oct 2025).");
  assert.deepEqual(rendered.segments.filter((segment) => segment.type === "ref"), [
    { type: "ref", ref_kind: "fact", ref_id: seriesId(5), format: "22.0%" },
  ]);
  assert.deepEqual([rendered.fact_bindings, rendered.source_refs], [[SERIES[5]!.binding], [TRACE_SOURCE]]);
});

test("a QoQ trend covers the derived quarters and the latest quarter's QoQ", () => {
  const packet = tracePacket(withDerived(SERIES.map(({ record }) => record)));
  const trend = (evidence: string[]) => checkAssertions([{ kind: "comparison", op: "trend", result: "fell", text: "x", evidence }], packet);
  const series = ["F18", "F19", "F20", "F21", "F22", "F23"];
  // 15.3% in Q2 2025 to 8.9% in Q4 2026.
  assert.deepEqual(trend([...series, "F8"]).rejected, []);
  const [rejection, ...others] = trend(series).rejected;
  assert.deepEqual(others, []);
  assert.match(rejection!.reason, /^comparison: leaves out Q4 2026, which shows revenue growth \(/);
});
