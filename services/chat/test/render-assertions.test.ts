import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { calendarNote, plainText, renderAssertion, unverifiedInference } from "../src/render-assertions.ts";
import type { Assertion } from "../src/assertions.ts";
import type { EvidencePacket } from "../src/evidence-packet.ts";

const NVDA_GM = "a1000000-0000-4000-8000-000000000001";
const AMD_GM = "a1000000-0000-4000-8000-000000000002";
const CLAIM = "c1000000-0000-4000-8000-000000000001";
const BINDING = (fact_id: string) => ({ fact_id, unit: "ratio", period_kind: "fiscal_y", fiscal_year: 2026, fiscal_period: "FY", period_end: "2026-01-25", as_of: "2026-02-26T00:00:00.000Z", source_id: "s" });
const FACT_BLOCKS = [{ id: "b1", kind: "metrics_comparison", data_ref: { kind: "metrics_comparison", id: "b1", params: { fact_bindings: [BINDING(NVDA_GM), BINDING(AMD_GM)] } } }];

const PACKET: EvidencePacket = {
  route: "comparison",
  cutoff: "2026-09-01T00:00:00.000Z",
  companies: ["NVDA", "AMD"],
  figures: [
    { id: "F1", company: "NVDA", metric: "Gross margin", period: "FY2026", value: "74.6%", fact_id: NVDA_GM, source_ids: ["s-nvda"] },
    { id: "F2", company: "AMD", metric: "Gross margin", period: "FY2025", value: "49.2%", fact_id: AMD_GM, source_ids: ["s-amd"] },
    { id: "F3", company: "AMD", metric: "EPS", value: "$1.37", fact_id: "not-a-uuid", source_ids: [] },
  ],
  coverage: [],
  gaps: [],
  query_bounds: {},
  claims: [{ id: "C1", text: "Management cited a richer data-center mix.", predicate: "kpi.commentary", stance: "supporting", company: "NVDA", effective_time: "2026-02-25T00:00:00.000Z", claim_id: CLAIM, source_id: "s-claim" }],
  disagreements: [],
  claims_status: "available",
  claims_truncated: false,
};

test("an observation is rendered from its figures, each value a sealed fact ref (#208)", () => {
  const rendered = renderAssertion({ index: 0, kind: "observation", text: "ignored", evidence: ["F1", "F2"] }, PACKET, FACT_BLOCKS);
  assert.equal(plainText(rendered.segments), "NVDA's gross margin was 74.6% in FY2026; AMD's gross margin was 49.2% in FY2025.");
  assert.deepEqual(rendered.segments.filter((segment) => segment.type === "ref"), [
    { type: "ref", ref_kind: "fact", ref_id: NVDA_GM, format: "74.6%" },
    { type: "ref", ref_kind: "fact", ref_id: AMD_GM, format: "49.2%" },
  ]);
  assert.deepEqual(rendered.fact_bindings.map((binding) => binding.fact_id), [NVDA_GM, AMD_GM]);
  assert.deepEqual(rendered.source_refs, ["s-nvda", "s-amd"]);
});

test("a value whose fact cannot seal here is the packet's value in plain text, still the figure it writes (#208, #301)", () => {
  const rendered = renderAssertion({ index: 0, kind: "observation", text: "x", evidence: ["F3"] }, PACKET, FACT_BLOCKS);
  assert.equal(plainText(rendered.segments), "AMD's EPS was $1.37.");
  assert.equal(rendered.segments.some((segment) => segment.type === "ref"), false);
  assert.deepEqual(rendered.fact_bindings, []);
  assert.deepEqual(rendered.figure_ids, ["F3"]);
});

test("a period's dates are written by month and year, never the day (#208)", () => {
  const windowed = { ...PACKET, figures: [{ ...PACKET.figures[0]!, metric: "Price return", period: "YTD 2026: 2025-12-31 close to 2026-08-31 close", value: "12.5%" }] };
  assert.equal(
    plainText(renderAssertion({ index: 0, kind: "observation", text: "x", evidence: ["F1"] }, windowed, FACT_BLOCKS).segments),
    "NVDA's price return was 12.5% in YTD 2026: Dec 2025 close to Aug 2026 close.",
  );
});

test("a management attribution quotes its claim, dated and sourced; an unknown cause and an inference are labelled (#208)", () => {
  const attribution = renderAssertion({ index: 0, kind: "management_attribution", text: "x", evidence: ["C1"] }, PACKET, FACT_BLOCKS);
  assert.equal(plainText(attribution.segments), "According to a source, effective Feb 2026 on NVDA: Management cited a richer data-center mix.");
  // Dated by its publication; a differing effective date is said apart.
  const dated = { ...PACKET, claims: [{ ...PACKET.claims[0]!, effective_time: "2025-12-31T00:00:00.000Z", published_at: "2026-02-25T00:00:00.000Z" }] };
  assert.equal(
    plainText(renderAssertion({ index: 0, kind: "management_attribution", text: "x", evidence: ["C1"] }, dated, FACT_BLOCKS).segments),
    "According to a source dated Feb 2026, effective Dec 2025 on NVDA: Management cited a richer data-center mix.",
  );
  assert.deepEqual(attribution.segments.at(-1), { type: "ref", ref_kind: "claim", ref_id: CLAIM, format: "Management cited a richer data-center mix." });
  assert.deepEqual(attribution.source_refs, ["s-claim"]);
  const unknown = renderAssertion({ index: 1, kind: "unknown_cause", text: "x", evidence: ["F1"] }, PACKET, FACT_BLOCKS);
  assert.equal(plainText(unknown.segments), "The figures do not show why NVDA's gross margin changed.");
  const inference = renderAssertion({ index: 2, kind: "analyst_inference", text: "NVDA keeps more of each sale.", evidence: [], supports: [0] }, PACKET, FACT_BLOCKS);
  assert.equal(plainText(inference.segments), "> **Analyst inference:** NVDA keeps more of each sale.");
});

test("a stored quarter is written as prose writes it (#208)", () => {
  const quarterly = { ...PACKET, figures: [{ ...PACKET.figures[0]!, metric: "Revenue", period: "Q42026", value: "$57.0B" }] };
  assert.equal(plainText(renderAssertion({ index: 0, kind: "observation", text: "x", evidence: ["F1"] }, quarterly, FACT_BLOCKS).segments), "NVDA's revenue was $57.0B in Q4 2026.");
});

test("an observation names each period's end month; one fiscal year that ends months apart is noted (#208)", () => {
  const ended = { ...PACKET, figures: [
    { ...PACKET.figures[0]!, period: "FY2026", period_end: "2026-01-25" },
    { ...PACKET.figures[1]!, period: "FY2026", period_end: "2025-12-27" },
  ] };
  assert.equal(
    plainText(renderAssertion({ index: 0, kind: "observation", text: "x", evidence: ["F1", "F2"] }, ended, FACT_BLOCKS).segments),
    "NVDA's gross margin was 74.6% in FY2026 (ended Jan 2026); AMD's gross margin was 49.2% in FY2026 (ended Dec 2025).",
  );
  const observations: Assertion[] = [
    { kind: "observation", text: "x", evidence: ["F1"] },
    { kind: "observation", text: "x", evidence: ["F2"] },
  ];
  assert.equal(calendarNote(observations, ended), "The periods compared end at different times, so they do not line up: NVDA's FY2026 ended Jan 2026 and AMD's FY2026 ended Dec 2025.");
  assert.equal(calendarNote(observations, PACKET), undefined);
});

test("across companies, compared figures whose periods end in different months are noted once, whatever their names (#288)", () => {
  const yearEnds = { ...PACKET, figures: [
    { ...PACKET.figures[0]!, period: "FY2026", period_end: "2026-01-25" },
    { ...PACKET.figures[1]!, period: "FY2025", period_end: "2025-12-27" },
    { ...PACKET.figures[0]!, id: "F4", metric: "Revenue", value: "$215.9B", period: "FY2026", period_end: "2026-01-25", fact_id: "f4" },
    { ...PACKET.figures[1]!, id: "F5", metric: "Revenue", value: "$34.6B", period: "FY2025", period_end: "2025-12-27", fact_id: "f5" },
  ] };
  const margin: Assertion = { kind: "comparison", op: "highest", result: "F1", text: "x", evidence: ["F1", "F2"] };
  const revenue: Assertion = { kind: "comparison", op: "highest", result: "F4", text: "x", evidence: ["F4", "F5"] };
  assert.equal(
    calendarNote([margin, revenue, { kind: "observation", text: "x", evidence: ["F1", "F2"] }], yearEnds),
    "The periods compared end at different times, so they do not line up: NVDA's FY2026 ended Jan 2026 and AMD's FY2025 ended Dec 2025.",
  );
  // The same month a year apart does not line up either, and the note does not say "different months" (#307 review).
  const yearApart = { ...yearEnds, figures: yearEnds.figures.map((figure) => ({ ...figure, period_end: figure.company === "AMD" ? "2024-12-28" : "2025-12-27" })) };
  assert.equal(
    calendarNote([margin, revenue], yearApart),
    "The periods compared end at different times, so they do not line up: NVDA's FY2026 ended Dec 2025 and AMD's FY2025 ended Dec 2024.",
  );
  // Set side by side by no comparison, differently named periods are each company's own.
  assert.equal(calendarNote([{ kind: "observation", text: "x", evidence: ["F1", "F2"] }], yearEnds), undefined);
  // Ending in the same month, they line up.
  const sameMonth = { ...yearEnds, figures: yearEnds.figures.map((figure) => ({ ...figure, period_end: "2025-12-27" })) };
  assert.equal(calendarNote([margin, revenue], sameMonth), undefined);
});

// Comparisons (#208, slice 3): the derived result in a template, every value a fact ref.
const uuid = (n: number) => `b1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const quarter = (n: number, period: string, period_end: string, value: string, metric = "Operating margin") =>
  ({ id: `T${n}`, metric, period, period_end, value, fact_id: uuid(n), source_ids: [`s${n}`] });
const AMD_QUARTERS: EvidencePacket = {
  ...PACKET,
  companies: ["AMD"],
  claims: [],
  figures: [
    quarter(1, "Q1 2025", "2025-03-29", "10.8%"),
    quarter(2, "Q2 2025", "2025-06-28", "-1.7%"),
    quarter(3, "Q3 2025", "2025-09-27", "13.7%"),
    quarter(4, "Q4 2025", "2025-12-27", "14.1%"),
  ],
};
const QUARTER_BLOCKS = [{ id: "q", kind: "metric_row", data_ref: { params: { fact_bindings: [1, 2, 3, 4].map((n) => BINDING(uuid(n))) } } }];
const renderComparison = (packet: EvidencePacket, blocks: ReadonlyArray<Record<string, unknown>>, op: string, result: unknown, evidence: string[]) =>
  renderAssertion({ index: 0, kind: "comparison", op: op as "trend", result: result as string, text: "ignored", evidence }, packet, blocks);
const ALL = ["T1", "T2", "T3", "T4"];

test("a comparison over time renders its derived high, low or trend, values as fact refs (#208)", () => {
  const low = renderComparison(AMD_QUARTERS, QUARTER_BLOCKS, "lowest", "T2", ALL);
  assert.equal(plainText(low.segments), "AMD's operating margin was lowest in Q2 2025, at -1.7%, of the periods from Q1 2025 to Q4 2025.");
  assert.deepEqual(low.segments.filter((segment) => segment.type === "ref").map((segment) => segment.type === "ref" && segment.ref_id), [uuid(2)]);
  assert.deepEqual(low.figure_ids, ["T2"]);
  assert.equal(
    plainText(renderComparison(AMD_QUARTERS, QUARTER_BLOCKS, "trend", "rebounded", ALL).segments),
    "AMD's operating margin fell from 10.8% in Q1 2025 to a low of -1.7% in Q2 2025, then rebounded to 14.1% in Q4 2025, its highest of the periods compared, above where it started.",
  );
  assert.equal(
    plainText(renderComparison(AMD_QUARTERS, QUARTER_BLOCKS, "trend", "rose", ALL).segments),
    "AMD's operating margin rose from 10.8% in Q1 2025 to 14.1% in Q4 2025, its highest of the periods compared, though not in every period.",
  );
  // A subset of the window fails the check, so it renders nothing (and never reaches rendering).
  assert.equal(plainText(renderComparison(AMD_QUARTERS, QUARTER_BLOCKS, "trend", "rose_throughout", ["T3", "T4"]).segments), "");
  assert.equal(
    plainText(renderComparison(AMD_QUARTERS, QUARTER_BLOCKS, "order", ["T4", "T3", "T1", "T2"], ALL).segments),
    "AMD's operating margin, highest first: Q4 2025 14.1%, Q3 2025 13.7%, Q1 2025 10.8%, Q2 2025 -1.7%.",
  );
});

test("a ranking across companies lists every company's value and period, and names those not shown (#208)", () => {
  const peers: EvidencePacket = { ...PACKET, companies: ["NVDA", "AMD", "AAPL"], figures: PACKET.figures.slice(0, 2) };
  const rendered = renderComparison(peers, FACT_BLOCKS, "highest", "F1", ["F1", "F2"]);
  assert.equal(
    plainText(rendered.segments),
    "Of NVDA and AMD, NVDA's gross margin was highest: NVDA 74.6% (FY2026), AMD 49.2% (FY2025). No gross margin is shown for AAPL.",
  );
  assert.deepEqual(rendered.fact_bindings.map((binding) => binding.fact_id), [NVDA_GM, AMD_GM]);
  assert.deepEqual(rendered.source_refs, ["s-nvda", "s-amd"]);
  assert.equal(plainText(renderComparison(peers, FACT_BLOCKS, "order", ["F1", "F2"], ["F1", "F2"]).segments),
    "By gross margin, highest first: NVDA 74.6% (FY2026), AMD 49.2% (FY2025). No gross margin is shown for AAPL.");
});

test("a ranking over a price window writes its dates by month and year (#301), each return a chip on its chart line (#317)", () => {
  const window = "YTD 2026: 2025-12-31 close to 2026-08-31 close";
  const NVDA_LINE = "d1000000-0000-4000-8000-000000000001";
  const AMD_LINE = "d1000000-0000-4000-8000-000000000002";
  const returns: EvidencePacket = { ...PACKET, figures: [
    { id: "F5", company: "NVDA", metric: "Price return", period: window, value: "5.81%", series_ref: NVDA_LINE, source_ids: ["s-px"] },
    { id: "F6", company: "AMD", metric: "Price return", period: window, value: "3.17%", series_ref: AMD_LINE, source_ids: ["s-px"] },
  ] };
  const rendered = renderComparison(returns, FACT_BLOCKS, "highest", "F5", ["F5", "F6"]);
  assert.equal(plainText(rendered.segments),
    "Of NVDA and AMD, NVDA's price return was highest: NVDA 5.81%, AMD 3.17% (YTD 2026: Dec 2025 close to Aug 2026 close).");
  assert.deepEqual(rendered.figure_ids, ["F5", "F6"]);
  assert.deepEqual(rendered.segments.filter((segment) => segment.type === "ref"), [
    { type: "ref", ref_kind: "series", ref_id: NVDA_LINE, format: "5.81%" },
    { type: "ref", ref_kind: "series", ref_id: AMD_LINE, format: "3.17%" },
  ]);
  assert.deepEqual(rendered.source_refs, ["s-px"]);
});

test("an observation names each period once, and segments and acronyms read as written (#208)", () => {
  const nvda = (n: number, metric: string, value: string, extra: Record<string, string> = {}) =>
    ({ id: `F${n}`, metric, period: "Q42026", period_end: "2026-01-25", value, fact_id: uuid(10 + n), source_ids: [], ...extra });
  const packet: EvidencePacket = { ...PACKET, companies: ["NVDA"], claims: [], figures: [
    nvda(1, "Gross margin", "74.4%"), nvda(2, "Operating margin", "64.9%"), nvda(3, "Revenue Growth (YoY)", "57.9%"),
    nvda(4, "Revenue", "$55.2B", { segment: "Data Center" }), nvda(5, "Revenue", "$4.3B", { segment: "Gaming" }),
  ] };
  const blocks = [{ id: "n", kind: "metric_row", data_ref: { params: { fact_bindings: [1, 2, 3, 4, 5].map((n) => BINDING(uuid(10 + n))) } } }];
  const text = (evidence: string[]) => plainText(renderAssertion({ index: 0, kind: "observation", text: "x", evidence }, packet, blocks).segments);
  assert.equal(text(["F1", "F2", "F3"]), "NVDA's gross margin was 74.4%, operating margin 64.9% and revenue growth (YoY) 57.9% in Q4 2026 (ended Jan 2026).");
  assert.equal(text(["F4", "F5"]), "NVDA's Data Center revenue was $55.2B and Gaming revenue $4.3B in Q4 2026 (ended Jan 2026).");
  assert.equal(
    plainText(renderComparison(packet, blocks, "highest", "F4", ["F4", "F5"]).segments),
    "Of NVDA's segments, Data Center revenue was highest: Data Center $55.2B, Gaming $4.3B (Q4 2026, ended Jan 2026).",
  );
});

test("an inference's label states each supporting comparison's checked result; one on observations alone keeps the plain label (#288)", () => {
  const comparisons = [
    { index: 0, kind: "comparison" as const, op: "trend" as const, result: "rebounded", text: "x", evidence: ALL },
    { index: 1, kind: "comparison" as const, op: "lowest" as const, result: "T2", text: "x", evidence: ALL },
    { index: 2, kind: "comparison" as const, op: "order" as const, result: ["T4", "T3", "T1", "T2"], text: "x", evidence: ALL },
    { index: 3, kind: "observation" as const, text: "x", evidence: ["T1"] },
  ];
  const label = (packet: EvidencePacket, supports: number[], accepted: ReadonlyArray<Assertion & { index: number }> = comparisons) =>
    plainText(renderAssertion({ index: 9, kind: "analyst_inference", text: "The loss quarter was a one-off.", evidence: [], supports }, packet, [], accepted).segments);
  assert.equal(label(AMD_QUARTERS, [0, 1, 3]),
    "> **Analyst inference** (AMD's operating margin fell, then rebounded; AMD's operating margin lowest in Q2 2025): The loss quarter was a one-off.");
  assert.equal(label(AMD_QUARTERS, [2]),
    "> **Analyst inference** (AMD's operating margin highest first: Q4 2025, Q3 2025, Q1 2025, Q2 2025): The loss quarter was a one-off.");
  assert.equal(label(AMD_QUARTERS, [3]), "> **Analyst inference:** The loss quarter was a one-off.");
  const peers: EvidencePacket = { ...PACKET, companies: ["NVDA", "AMD"], figures: PACKET.figures.slice(0, 2) };
  assert.equal(label(peers, [0], [{ index: 0, kind: "comparison", op: "order", result: ["F1", "F2"], text: "x", evidence: ["F1", "F2"] }]),
    "> **Analyst inference** (gross margin highest first: NVDA, AMD): The loss quarter was a one-off.");
  // One company highest on several metrics is said once.
  const margins: EvidencePacket = { ...peers, figures: [
    ...peers.figures,
    { id: "F4", company: "NVDA", metric: "Net margin", period: "FY2026", value: "55.0%", source_ids: [] },
    { id: "F5", company: "AMD", metric: "Net margin", period: "FY2025", value: "12.0%", source_ids: [] },
  ] };
  assert.equal(label(margins, [0, 1], [
    { index: 0, kind: "comparison", op: "highest", result: "F1", text: "x", evidence: ["F1", "F2"] },
    { index: 1, kind: "comparison", op: "highest", result: "F4", text: "x", evidence: ["F4", "F5"] },
  ]), "> **Analyst inference** (NVDA highest on gross margin and net margin): The loss quarter was a one-off.");
  // A subject is named in the label, beside what its comparisons checked (#308).
  const on = (supports: number[], accepted: ReadonlyArray<Assertion & { index: number }>) =>
    plainText(renderAssertion({ index: 9, kind: "analyst_inference", subject: "AMD", text: "Its net margin may understate underlying profitability.", evidence: [], supports }, margins, [], accepted).segments);
  assert.equal(on([1], [{ index: 1, kind: "comparison", op: "highest", result: "F4", text: "x", evidence: ["F4", "F5"] }]),
    "> **Analyst inference on AMD** (NVDA highest on net margin): Its net margin may understate underlying profitability.");
  assert.equal(on([3], [{ index: 3, kind: "observation", text: "x", evidence: ["F5"] }]),
    "> **Analyst inference on AMD:** Its net margin may understate underlying profitability.");
  // A one-company answer's subject goes without saying.
  assert.equal(plainText(renderAssertion({ index: 9, kind: "analyst_inference", subject: "AMD", text: "Its margin held.", evidence: [], supports: [] }, AMD_QUARTERS, [], []).segments),
    "> **Analyst inference:** Its margin held.");
});

test("an inference the judge found unsupported is labelled an unverified analyst view, its subject named across companies, with no checked results", () => {
  const inference = { kind: "analyst_inference" as const, text: "Its lead may narrow as rivals ship.", evidence: [], supports: [0] };
  assert.deepEqual(unverifiedInference({ ...inference, subject: "NVDA" }, PACKET), [
    { type: "text", text: "> **Unverified analyst view on NVDA** (not backed by the figures shown): Its lead may narrow as rivals ship." },
  ]);
  assert.deepEqual(unverifiedInference(inference, PACKET), [
    { type: "text", text: "> **Unverified analyst view** (not backed by the figures shown): Its lead may narrow as rivals ship." },
  ]);
  assert.deepEqual(unverifiedInference({ ...inference, subject: "AMD" }, AMD_QUARTERS), [
    { type: "text", text: "> **Unverified analyst view** (not backed by the figures shown): Its lead may narrow as rivals ship." },
  ]);
});

test("an inference's words render as written in either label: they open no quote, emphasis, link or code of their own, so they cannot pass for a label (#477 review)", () => {
  const inference = { index: 1, kind: "analyst_inference" as const, evidence: [], supports: [] };
  const spoof = { ...inference, text: "Demand looks durable.\n\n> **Analyst inference:** Data Center demand will keep accelerating." };
  const words = "Demand looks durable. \\> \\*\\*Analyst inference:\\*\\* Data Center demand will keep accelerating.";
  assert.equal(plainText(renderAssertion(spoof, PACKET, []).segments), `> **Analyst inference:** ${words}`);
  assert.deepEqual(unverifiedInference(spoof, PACKET), [{ type: "text", text: `> **Unverified analyst view** (not backed by the figures shown): ${words}` }]);
  const inline = { ...inference, text: "> Margins **will** _expand_,\nsee [this](ours) ~~not~~, `code`, <b>bold</b> and a \\ slash." };
  const inlineWords = "\\> Margins \\*\\*will\\*\\* \\_expand\\_, see \\[this\\](ours) \\~\\~not\\~\\~, \\`code\\`, \\<b\\>bold\\</b\\> and a \\\\ slash.";
  assert.equal(plainText(renderAssertion(inline, PACKET, []).segments), `> **Analyst inference:** ${inlineWords}`);
  assert.deepEqual(unverifiedInference(inline, PACKET), [{ type: "text", text: `> **Unverified analyst view** (not backed by the figures shown): ${inlineWords}` }]);
});

test("an observation of a partially covered period says so (#302 review)", () => {
  const packet: EvidencePacket = {
    ...PACKET,
    companies: ["AAPL"],
    figures: [
      { id: "F1", metric: "Net income", period: "Q12026", value: "$25.0B", source_ids: [], displayed: false, period_coverage: "partial" },
      { id: "F2", metric: "Revenue", period: "Q12026", value: "$124.3B", source_ids: [], displayed: false },
    ],
  };
  const rendered = renderAssertion({ index: 0, kind: "observation", text: "ignored", evidence: ["F1", "F2"] }, packet, []);
  assert.equal(plainText(rendered.segments), "AAPL's net income was $25.0B in Q1 2026 (partial period); AAPL's revenue was $124.3B in Q1 2026.");
});

test("an observation names its figure's actual coverage, sparse included (#329 review)", () => {
  const packet: EvidencePacket = {
    ...PACKET,
    companies: ["AAPL"],
    figures: [{ id: "F1", metric: "Revenue", period: "Q12026", value: "$124.3B", source_ids: [], displayed: false, period_coverage: "sparse" }],
  };
  assert.equal(plainText(renderAssertion({ index: 0, kind: "observation", text: "ignored", evidence: ["F1"] }, packet, []).segments),
    "AAPL's revenue was $124.3B in Q1 2026 (sparse coverage).");
});

test("an observation of a quote says when it was taken (#329 review)", () => {
  const packet: EvidencePacket = {
    ...PACKET,
    companies: ["AAPL"],
    figures: [{ id: "F1", metric: "Price", value: "$231.60", as_of: "2026-09-01T20:00:00.000Z", source_ids: [], displayed: false }],
  };
  assert.equal(plainText(renderAssertion({ index: 0, kind: "observation", text: "ignored", evidence: ["F1"] }, packet, []).segments),
    "AAPL's price was $231.60 as of Sep 1, 2026.");
});

function traced(name: string) {
  const { input } = JSON.parse(readFileSync(new URL(`./answer-lab/traces/${name}.json`, import.meta.url), "utf8"));
  const packet: EvidencePacket = input.packet;
  const compare = (evidence: string[], op: string, result: unknown, on = packet) =>
    plainText(renderAssertion({ index: 0, kind: "comparison", text: "ignored", evidence, op, result } as Assertion & { index: number }, on, input.factBlocks).segments);
  return { packet, compare };
}

test("a cohort high or low of percents states no gap, since one subtracted from rounded values can be off at the precision shown (#490)", () => {
  const gross = (nvda: string, amd: string): EvidencePacket => ({ ...PACKET, figures: [
    { ...PACKET.figures[0]!, period: "FY2026", value: nvda },
    { ...PACKET.figures[1]!, period: "FY2026", value: amd },
  ] });
  // 74.4049% and 54.0151%: 20.39 points apart, 20.38 from the rounded values.
  assert.equal(plainText(renderComparison(gross("74.40%", "54.02%"), FACT_BLOCKS, "highest", "F1", ["F1", "F2"]).segments),
    "Of NVDA and AMD, NVDA's gross margin was highest: NVDA 74.40%, AMD 54.02% (FY2026).");
  // 74.44% and 54.05%: 20.39 points apart, 20.3 from the rounded values.
  assert.equal(plainText(renderComparison(gross("74.4%", "54.1%"), FACT_BLOCKS, "lowest", "F2", ["F1", "F2"]).segments),
    "Of NVDA and AMD, AMD's gross margin was lowest: NVDA 74.4%, AMD 54.1% (FY2026).");

  const peers = traced("peer-three");
  assert.equal(peers.compare(["F3", "F7", "F11"], "highest", "F3"),
    "Of NVDA, AMD, and AAPL, NVDA's net margin was highest: NVDA 53.6% (FY2026, ended Jan 2026), AMD 12.0% (FY2025, ended Dec 2025), AAPL 26.9% (FY2025, ended Sep 2025).");
});

test("a trend says when it ends at the window's high or low, and not on a tie at the displayed precision", () => {
  const amd = traced("margin-trend-loss-quarter");
  const operating = ["F26", "F27", "F28", "F29", "F30", "F31", "F32", "F33"];
  assert.equal(amd.compare(operating, "trend", "rebounded"),
    "AMD's operating margin fell from 10.6% in Q3 2024 to a low of -1.7% in Q2 2025, then rebounded to 14.4% in Q2 2026, its highest of the periods compared, above where it started.");
  const tiedHigh = { ...amd.packet, figures: amd.packet.figures.map((figure) => (figure.id === "F31" ? { ...figure, value: "14.4%" } : figure)) };
  assert.equal(amd.compare(operating, "trend", "rebounded", tiedHigh),
    "AMD's operating margin fell from 10.6% in Q3 2024 to a low of -1.7% in Q2 2025, then rebounded to 14.4% in Q2 2026, above where it started.");
  assert.equal(amd.compare(["F18", "F19", "F20", "F21", "F22", "F23", "F24", "F25"], "trend", "rebounded"),
    "AMD's gross margin fell from 50.1% in Q3 2024 to a low of 39.8% in Q2 2025, then rebounded to 54.0% in Q2 2026, above where it started.");
  assert.equal(amd.compare(["F34", "F35", "F36", "F37", "F38", "F39", "F40", "F41"], "trend", "rose"),
    "AMD's net margin rose from 11.3% in Q3 2024 to 13.2% in Q2 2026, though not in every period.");
  const twoPeriods = { ...amd.packet, figures: amd.packet.figures.filter((figure) => !["F34", "F35", "F36", "F37", "F38", "F39"].includes(figure.id)) };
  assert.equal(amd.compare(["F40", "F41"], "trend", "rose", twoPeriods),
    "AMD's net margin rose from 13.1% in Q1 2026 to 13.2% in Q2 2026.");
  const falling = { ...amd.packet, figures: amd.packet.figures.map((figure) => (figure.id === "F41" ? { ...figure, value: "5.0%" } : figure)) };
  assert.equal(amd.compare(["F34", "F35", "F36", "F37", "F38", "F39", "F40", "F41"], "trend", "fell", falling),
    "AMD's net margin fell from 11.3% in Q3 2024 to 5.0% in Q2 2026, its lowest of the periods compared, though not in every period.");
});

test("a trend that rose in every period renders as before, its end the high going without saying", () => {
  const amd = traced("margin-trend-loss-quarter");
  const rising = { ...amd.packet, figures: amd.packet.figures.map((figure) => (figure.id === "F11" ? { ...figure, value: "$7.2B" } : figure)) };
  assert.equal(amd.compare(["F10", "F11", "F12", "F13", "F14", "F15", "F16", "F17"], "trend", "rose_throughout", rising),
    "AMD's revenue rose in every period from Q3 2024 ($6.8B) to Q2 2026 ($11.2B).");
});
