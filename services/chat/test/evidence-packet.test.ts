import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildEvidencePacket, claimSelection, packetForModel, type ClaimRecord } from "../src/evidence-packet.ts";
import { resolveResearchScope, type ScopeProposal } from "../src/research-scope.ts";
import { proposal } from "./scope-fixtures.ts";

const NVDA = { issuer_id: "60000000-0000-4000-8000-000000000001", label: "NVDA" };
const AMD = { issuer_id: "60000000-0000-4000-8000-000000000002", label: "AMD" };
const AAPL = { issuer_id: "60000000-0000-4000-8000-000000000003", label: "AAPL" };
const CUTOFF = "2026-09-01T00:00:00.000Z";
const scope = (_question: string, companies = [NVDA], read: ScopeProposal = proposal()) =>
  resolveResearchScope({ companies, prior: null, asOf: CUTOFF, proposal: read });
const REVENUE = { metrics: ["income_statement"], items: ["revenue"] } as const;
const GROSS_MARGIN_CHANGE = proposal({ asks: ["margins", "margin_trend"], metrics: ["income_statement"], items: ["gross_margin"], period: { kind: "fiscal_quarter", fiscal_period: "Q1", fiscal_year: 2026 } });

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

const NVDA_LINE = "d1000000-0000-4000-8000-000000000001";
const AMD_LINE = "d1000000-0000-4000-8000-000000000002";
const PERF = {
  id: "perf",
  kind: "perf_comparison",
  title: "Price return YTD 2026 (split-adjusted, excluding dividends)",
  default_range: "YTD 2026: 2025-12-31 close to 2026-08-31 close",
  data_ref: { kind: "perf_comparison", id: "perf", params: { series_refs: [NVDA_LINE, AMD_LINE] } },
  source_refs: ["s-px"],
  subject_labels: ["NVDA", "AMD"],
  series: [
    { name: "NVDA", unit: "%", points: [{ x: "2025-12-31", y: 0 }, { x: "2026-08-31", y: 6.6 }] },
    { name: "AMD", unit: "%", points: [{ x: "2025-12-31", y: 0 }, { x: "2026-08-31", y: 3.58 }] },
  ],
};

test("an analyst turn's figures are its price chart's alone: a table or bars a saved answer holds add none (#398)", () => {
  const ytd = scope("Compare NVDA, AMD and AAPL YTD", [NVDA, AMD, AAPL], proposal({ asks: ["price_window"] }));
  const packet = buildEvidencePacket({ scope: ytd, factBlocks: [LATEST, BARS, PERF], cutoff: CUTOFF });
  assert.equal(packet.cutoff, CUTOFF);
  assert.deepEqual(packet.figures.map((figure) => [figure.id, figure.company, figure.metric, figure.period, figure.value, figure.source_ids]), [
    ["F1", "NVDA", "Price return", PERF.default_range, "6.6%", ["s-px"]],
    ["F2", "AMD", "Price return", PERF.default_range, "3.58%", ["s-px"]],
  ]);
  assert.deepEqual(packet.coverage, [
    { company: "NVDA", status: "shown" },
    { company: "AMD", status: "shown" },
    { company: "AAPL", status: "not_shown" },
  ]);
  assert.deepEqual(packet.query_bounds, { price_window: "year to date, to the 2026-09-01 cutoff" });
  const quarter = buildEvidencePacket({ scope: scope("Analyze NVDA's latest quarter"), factBlocks: [LATEST, BARS], cutoff: CUTOFF });
  assert.deepEqual([quarter.route, quarter.figures, quarter.coverage, quarter.query_bounds], ["latest_quarter", [], [{ company: "NVDA", status: "not_shown" }], {}]);
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

test("an inherited YTD window is bounded at its own cutoff (#207)", () => {
  const first = scope("Compare NVDA with AMD YTD", [NVDA, AMD], proposal({ asks: ["price_window"] }));
  const next = resolveResearchScope({
    companies: [NVDA, AMD],
    prior: first,
    asOf: "2026-09-05T00:00:00.000Z",
    proposal: proposal({ asks: ["explains"] }),
  });
  const packet = buildEvidencePacket({ scope: next, factBlocks: [], cutoff: "2026-09-05T00:00:00.000Z" });
  assert.equal(packet.query_bounds.price_window, "year to date, to the 2026-09-01 cutoff");
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
  const fiscal = claimSelection(scope("Compare NVDA with AMD for fiscal year 2025", [NVDA, AMD], proposal({ period: { kind: "fiscal_year", fiscal_year: 2025 } })), CUTOFF);
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
  const ytd = scope("Compare NVDA with AMD YTD", [NVDA, AMD], proposal({ asks: ["price_window"] }));
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

test("a named quarter's claims are read from the year before it (#290)", () => {
  const named = scope("Why did AMD's operating margin turn negative in Q2 2025?", [AMD], proposal({ asks: ["explains", "margins"], metrics: ["income_statement"], items: ["operating_income"], period: { kind: "fiscal_quarter", fiscal_period: "Q2", fiscal_year: 2025 } }));
  assert.equal(claimSelection(named, CUTOFF).effective_from, "2024-01-01T00:00:00.000Z");
});

test("a price return carries its chart line's series and the chart's sources, and the model sees neither (#317)", () => {
  const packet = buildEvidencePacket({ cutoff: CUTOFF, factBlocks: [PERF] });
  assert.deepEqual(packet.figures.map((figure) => [figure.id, figure.company, figure.value, figure.series_ref, figure.source_ids]), [
    ["F1", "NVDA", "6.6%", NVDA_LINE, ["s-px"]],
    ["F2", "AMD", "3.58%", AMD_LINE, ["s-px"]],
  ]);
  const model = JSON.stringify(packetForModel(packet));
  assert.deepEqual([model.includes(NVDA_LINE), model.includes("s-px"), model.includes("block_id"), model.includes("\"6.6%\"")], [false, false, false, true]);
});

test("a recorded trace carries the packet its model was sent", () => {
  const trace = JSON.parse(readFileSync(new URL("./answer-lab/traces/single-latest-quarter.json", import.meta.url), "utf8"));
  const sent = JSON.parse(trace.exchange.messages.find((message: { role: string }) => message.role === "user").content).evidence_packet;
  const recorded = packetForModel(trace.input.packet);
  assert.deepEqual([recorded.figures, recorded.coverage], [sent.figures, sent.coverage]);
  assert.equal(sent.figures.length, 17);
});

