// Analyst prose written from an engine answer's published results (#398 step 4):
// each value or gap result is a packet figure cited by its result id, and a
// rendered figure is a result ref the server checks against that block.

import assert from "node:assert/strict";
import test from "node:test";

import type { FinancialAnswerContent, FinancialPlanV1, PresentedResult } from "../../financial-core/src/index.ts";
import type { LlmChatRequest } from "../../llm/src/index.ts";
import { answerTurn } from "../src/answer-trace.ts";
import { checkAssertions } from "../src/assertions.ts";
import { enginePacket, packetForModel } from "../src/evidence-packet.ts";
import { judgeCases } from "../src/inference-judge.ts";
import { resultRefProblem } from "../src/prose-refs.ts";
import { plainText, renderAssertion } from "../src/render-assertions.ts";

const RESULT = (n: number) => `5e000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NOT_REPORTED = "No reported fact matched the requested metric, subject, and period.";

const LABELS = {
  "subject:a": { kind: "subject", text: "NVIDIA Corporation", slot_id: "a" },
  "subject:b": { kind: "subject", text: "Advanced Micro Devices, Inc.", slot_id: "b" },
  "subject:c": { kind: "subject", text: "Apple Inc.", slot_id: "c" },
  "measure:m0": { kind: "measure", text: "Revenue" },
  "measure:m1": { kind: "measure", text: "Gross margin (gross profit / revenue)" },
  "measure:m2": { kind: "measure", text: "Quarter-over-quarter percent change in Revenue" },
  "measure:m3": { kind: "measure", text: "Revenue threshold check" },
  "measure:m4": { kind: "measure", text: "Year-over-year percent change in Revenue" },
  // A v1 answer named both changes alike (#493).
  "measure:m5": { kind: "measure", text: "Percent change in Revenue" },
  "period:p0": { kind: "period", text: "Q4 FY2026" },
  "period:p1": { kind: "period", text: "Q2 FY2026" },
  "period:p2": { kind: "period", text: "Q4 FY2026 vs Q4 FY2025" },
  "period:p3": { kind: "period", text: "Q4 FY2026 vs Q3 FY2026" },
  "period:p4": { kind: "period", text: "Q2 FY2026 vs Q2 FY2025" },
  "period:p5": { kind: "period", text: "Q2 FY2026 vs Q1 FY2026" },
  "period:p6": { kind: "period", text: "Q3 FY2026" },
} as const;

const value = (n: number, slot: string, measure: string, period: string, text: string): PresentedResult => ({
  result_id: RESULT(n),
  output_id: `out_${n}`,
  disposition: "verified",
  subject_label_id: `subject:${slot}`,
  measure_label_id: measure,
  period_label_id: period,
  presented: { kind: "value", text, full_text: text, value: "0", unit: { kind: "ratio" }, exact: true },
  result_hash: "0".repeat(64),
});
const gap = (n: number, slot: string, measure: string, period: string): PresentedResult => ({
  ...value(n, slot, measure, period, ""),
  disposition: "missing",
  presented: { kind: "gap", text: NOT_REPORTED, reason_code: "missing_input" },
});

function content(results: ReadonlyArray<PresentedResult>, slots: ReadonlyArray<string>, periods: Record<string, unknown> = {}): FinancialAnswerContent {
  return {
    presentation_version: "financial-presentation.v2",
    template_version: "t",
    run_id: "5e000000-0000-4000-8000-0000000000aa",
    unit_id: "u1",
    knowledge_cutoff: "2026-09-01T00:00:00.000Z",
    coverage: { state: "partial", requested: results.length, verified: results.filter((result) => result.disposition === "verified").length },
    labels: { ...Object.fromEntries(Object.entries(LABELS).filter(([id]) => !id.startsWith("subject:") || slots.includes(id.slice(8)))), ...periods },
    results,
    presentations: [],
  } as FinancialAnswerContent;
}

// NVDA and AMD, each with its latest gross margin and its revenue growth
// over a quarter and a year, AMD's gross margin a gap, and a predicate.
const COMPARISON = content([
  value(1, "a", "measure:m1", "period:p0", "74.40%"),
  value(2, "a", "measure:m2", "period:p3", "8.94%"),
  value(3, "a", "measure:m4", "period:p2", "57.89%"),
  gap(4, "b", "measure:m1", "period:p1"),
  value(5, "b", "measure:m2", "period:p5", "4.67%"),
  value(6, "b", "measure:m4", "period:p4", "45.74%"),
  { ...value(7, "a", "measure:m3", "period:p0", ""), presented: { kind: "predicate", text: "NVIDIA Corporation — Revenue, Q4 FY2026, above USD 1.00: yes", outcome: true } },
], ["a", "b"]);
const TICKERS = new Map([["a", "NVDA"], ["b", "AMD"]]);

const REVENUE = [
  ["Q1 FY2025", "USD 26,044,000,000.00"], ["Q2 FY2025", "USD 30,040,000,000.00"], ["Q3 FY2025", "USD 35,082,000,000.00"], ["Q4 FY2025", "USD 39,331,000,000.00"],
  ["Q1 FY2026", "USD 44,062,000,000.00"], ["Q2 FY2026", "USD 46,743,000,000.00"], ["Q3 FY2026", "USD 57,006,000,000.00"], ["Q4 FY2026", "USD 62,100,000,000.00"],
] as const;
const QUARTERS = content(
  REVENUE.map(([, text], i) => value(10 + i, "a", "measure:m0", `period:q${i}`, text)),
  ["a"],
  Object.fromEntries(REVENUE.map(([period], i) => [`period:q${i}`, { kind: "period", text: period }])),
);

const block = (financial: FinancialAnswerContent) => ({ id: "financial-answer-x", kind: "financial_answer", financial });
const prose = (...segments: ReadonlyArray<Record<string, unknown>>) => ({ id: "commentary-x", kind: "rich_text", segments });

test("an engine answer's packet holds its value and gap results in order, each cited by its result, and no other figure", () => {
  assert.deepEqual(enginePacket(COMPARISON, TICKERS, null), {
    route: "financial_engine",
    cutoff: "2026-09-01T00:00:00.000Z",
    companies: ["NVDA", "AMD"],
    figures: [
      { id: "F1", company: "NVDA", metric: "Gross margin (gross profit / revenue)", period: "Q4 FY2026", value: "74.40%", result_id: RESULT(1), source_ids: [] },
      { id: "F2", company: "NVDA", metric: "Quarter-over-quarter percent change in Revenue", period: "Q4 FY2026 vs Q3 FY2026", value: "8.94%", result_id: RESULT(2), source_ids: [] },
      { id: "F3", company: "NVDA", metric: "Year-over-year percent change in Revenue", period: "Q4 FY2026 vs Q4 FY2025", value: "57.89%", result_id: RESULT(3), source_ids: [] },
      { id: "F4", company: "AMD", metric: "Gross margin (gross profit / revenue)", period: "Q2 FY2026", value: NOT_REPORTED, gap: NOT_REPORTED, result_id: RESULT(4), source_ids: [] },
      { id: "F5", company: "AMD", metric: "Quarter-over-quarter percent change in Revenue", period: "Q2 FY2026 vs Q1 FY2026", value: "4.67%", result_id: RESULT(5), source_ids: [] },
      { id: "F6", company: "AMD", metric: "Year-over-year percent change in Revenue", period: "Q2 FY2026 vs Q2 FY2025", value: "45.74%", result_id: RESULT(6), source_ids: [] },
    ],
    coverage: [{ company: "NVDA", status: "shown" }, { company: "AMD", status: "shown" }],
    gaps: [],
    query_bounds: {},
    claims: [],
    disagreements: [],
    claims_status: "none",
    claims_truncated: false,
  });
  // A peer the turn gave no ticker is named by the engine's label for it; one company names none.
  assert.deepEqual(enginePacket(COMPARISON, new Map([["a", "NVDA"]]), null).companies, ["NVDA", "Advanced Micro Devices, Inc."]);
  assert.deepEqual(enginePacket(QUARTERS, TICKERS, null).figures[0], { id: "F1", metric: "Revenue", period: "Q1 FY2025", value: "USD 26,044,000,000.00", result_id: RESULT(10), source_ids: [] });
});

test("the model sees a gap result as unavailable, with its reason and no value, and no result id", () => {
  const { figures } = packetForModel(enginePacket(COMPARISON, TICKERS, null)) as { figures: unknown[] };
  assert.deepEqual(figures[0], { id: "F1", company: "NVDA", metric: "Gross margin (gross profit / revenue)", period: "Q4 FY2026", value: "74.40%" });
  assert.deepEqual(figures[3], { id: "F4", company: "AMD", metric: "Gross margin (gross profit / revenue)", period: "Q2 FY2026", gap: NOT_REPORTED });
});

test("an assertion citing an id outside the engine packet is rejected", () => {
  const report = checkAssertions([
    { kind: "observation", text: "x", evidence: ["F1"] },
    { kind: "observation", text: "y", evidence: ["F7"] },
  ], enginePacket(COMPARISON, TICKERS, null));
  assert.deepEqual(report.accepted.map((entry) => entry.index), [0]);
  assert.deepEqual(report.rejected, [{ index: 1, text: "y", check: "reference", reason: 'unknown evidence id "F7"' }]);
});

test("an observation writes each engine value as a result ref, and a gap as its reason, never a number", () => {
  const packet = enginePacket(COMPARISON, TICKERS, null);
  const values = renderAssertion({ index: 0, kind: "observation", text: "x", evidence: ["F1"] }, packet, []);
  assert.deepEqual(values.segments, [
    { type: "text", text: "NVDA's gross margin (gross profit / revenue) was " },
    { type: "ref", ref_kind: "result", ref_id: RESULT(1), format: "74.40%", period: "Q4 FY2026" },
    { type: "text", text: " in Q4 FY2026" },
    { type: "text", text: "." },
  ]);
  const missing = renderAssertion({ index: 0, kind: "observation", text: "x", evidence: ["F6", "F4"] }, packet, []);
  assert.equal(plainText(missing.segments), `AMD's year-over-year percent change in revenue was 45.74% in Q2 FY2026 vs Q2 FY2025. AMD's gross margin (gross profit / revenue) in Q2 FY2026 is not available: ${NOT_REPORTED}`);
  assert.deepEqual(missing.segments.filter((segment) => segment.type === "ref").map((segment) => segment.type === "ref" && segment.ref_id), [RESULT(6)]);
});

test("a gap is never compared: a comparison citing one is rejected, and a cohort names its company as not shown", () => {
  const packet = enginePacket(COMPARISON, TICKERS, null);
  assert.deepEqual(checkAssertions([{ kind: "comparison", text: "x", evidence: ["F1", "F4"], op: "highest", result: "F1" }], packet).rejected,
    [{ index: 0, text: "x", check: "comparative", reason: "comparison: F4 is not available, so it is not compared" }]);
  assert.deepEqual(checkAssertions([{ kind: "unknown_cause", text: "x", evidence: ["F4"] }], packet).rejected.map((entry) => entry.check), ["kind"]);
  const three = enginePacket(content([
    value(1, "a", "measure:m1", "period:p0", "74.40%"),
    gap(2, "b", "measure:m1", "period:p1"),
    value(3, "c", "measure:m1", "period:p6", "47.06%"),
  ], ["a", "b", "c"]), new Map([["a", "NVDA"], ["b", "AMD"], ["c", "AAPL"]]), null);
  const report = checkAssertions([{ kind: "comparison", text: "x", evidence: ["F1", "F3"], op: "highest", result: "F1" }], three);
  assert.deepEqual(report.rejected, []);
  assert.equal(
    plainText(renderAssertion(report.accepted[0]!, three, []).segments),
    "Of NVDA and AAPL, NVDA's gross margin (gross profit / revenue) was highest: NVDA 74.40% (Q4 FY2026), AAPL 47.06% (Q3 FY2026). No gross margin (gross profit / revenue) is shown for AMD.",
  );
});

test("a trend orders the engine's quarters by their fiscal labels", () => {
  const packet = enginePacket(QUARTERS, new Map([["a", "NVDA"]]), null);
  const report = checkAssertions([{ kind: "comparison", text: "x", evidence: packet.figures.map((figure) => figure.id), op: "trend", result: "rose_throughout" }], packet);
  assert.deepEqual(report.rejected, []);
  assert.equal(
    plainText(renderAssertion(report.accepted[0]!, packet, []).segments),
    "NVDA's revenue rose in every period from Q1 FY2025 (USD 26,044,000,000.00) to Q4 FY2026 (USD 62,100,000,000.00).",
  );
});

test("a trend over time names the periods its company and metric show as gaps", () => {
  const packet = enginePacket(content(
    [...REVENUE.slice(0, 7).map(([, text], i) => value(10 + i, "a", "measure:m0", `period:q${i}`, text)), gap(17, "a", "measure:m0", "period:q7")],
    ["a"],
    Object.fromEntries(REVENUE.map(([period], i) => [`period:q${i}`, { kind: "period", text: period }])),
  ), new Map([["a", "NVDA"]]), null);
  const report = checkAssertions([{ kind: "comparison", text: "x", evidence: ["F1", "F2", "F3", "F4", "F5", "F6", "F7"], op: "trend", result: "rose_throughout" }], packet);
  assert.deepEqual(report.rejected, []);
  assert.equal(
    plainText(renderAssertion(report.accepted[0]!, packet, []).segments),
    "NVDA's revenue rose in every period from Q1 FY2025 (USD 26,044,000,000.00) to Q3 FY2026 (USD 57,006,000,000.00). No revenue is shown for Q4 FY2026.",
  );
});

test("growth across companies compares each company's change over the same span, whatever their fiscal calendars", () => {
  const packet = enginePacket(COMPARISON, TICKERS, null);
  const report = checkAssertions([
    { kind: "comparison", text: "year over year", evidence: ["F3", "F6"], op: "highest", result: "F3" },
    { kind: "comparison", text: "mixed spans", evidence: ["F3", "F5"], op: "highest", result: "F3" },
  ], packet);
  assert.deepEqual(report.rejected, [{ index: 1, text: "mixed spans", check: "comparative", reason: "comparison: a comparison is of one metric" }]);
  assert.equal(
    plainText(renderAssertion(report.accepted[0]!, packet, []).segments),
    "Of NVDA and AMD, NVDA's year-over-year percent change in revenue was highest: NVDA 57.89% (Q4 FY2026 vs Q4 FY2025), AMD 45.74% (Q2 FY2026 vs Q2 FY2025).",
  );
  // A v1 answer names both changes alike, each company with one shown and the other a gap: still one span.
  const oneEach = enginePacket(content([
    value(1, "a", "measure:m5", "period:p2", "57.89%"),
    gap(2, "a", "measure:m5", "period:p3"),
    gap(3, "b", "measure:m5", "period:p4"),
    value(4, "b", "measure:m5", "period:p5", "4.67%"),
  ], ["a", "b"]), TICKERS, null);
  assert.deepEqual(checkAssertions([{ kind: "comparison", text: "x", evidence: ["F1", "F4"], op: "highest", result: "F1" }], oneEach).rejected,
    [{ index: 0, text: "x", check: "comparative", reason: "comparison: changes across companies are compared over one span" }]);
});

test("negative engine amounts compare by their sign", () => {
  const losses = enginePacket(content([
    value(1, "a", "measure:m0", "period:p0", "USD -134,000,000.00"),
    value(2, "b", "measure:m0", "period:p1", "USD -50,000,000.00"),
  ], ["a", "b"]), TICKERS, null);
  const report = checkAssertions([{ kind: "comparison", text: "x", evidence: ["F1", "F2"], op: "lowest", result: "F1" }], losses);
  assert.deepEqual(report.rejected, []);
});

test("commentary passes the ref check only when each ref is a verified result of its own answer, as that answer shows it", () => {
  const answer = block(COMPARISON);
  const ref = (fields: Record<string, unknown>) => ({ type: "ref", ref_kind: "result", ref_id: RESULT(1), format: "74.40%", period: "Q4 FY2026", ...fields });
  assert.equal(resultRefProblem(prose({ type: "text", text: "NVDA's gross margin was " }, ref({})), answer), null);
  assert.equal(resultRefProblem(prose(ref({ format: "74.4%" })), answer), `ref 5e000000-0000-4000-8000-000000000001 shows "74.4%", not its result's "74.40%"`);
  assert.equal(resultRefProblem(prose(ref({ period: "Q3 FY2026" })), answer), `ref 5e000000-0000-4000-8000-000000000001 is dated "Q3 FY2026", not its result's "Q4 FY2026"`);
  assert.equal(resultRefProblem(prose(ref({ ref_id: RESULT(4), format: NOT_REPORTED, period: "Q2 FY2026" })), answer), "ref 5e000000-0000-4000-8000-000000000004 names no verified result of this answer");
  assert.equal(resultRefProblem(prose(ref({ ref_id: RESULT(10), format: "USD 26,044,000,000.00", period: "Q1 FY2025" })), answer), "ref 5e000000-0000-4000-8000-000000000010 names no verified result of this answer");
  assert.equal(resultRefProblem(prose({ type: "ref", ref_kind: "fact", ref_id: RESULT(1), format: "74.40%" }), answer), "a fact ref is not a result ref");
});

test("an answer written on an engine packet is sent only that packet, and its inference is judged beside the engine's figures", async () => {
  const packet = enginePacket(COMPARISON, TICKERS, null);
  const reply = [
    "NVDA's margin leads.",
    "```assertions",
    JSON.stringify([
      { kind: "observation", text: "NVDA's gross margin was [[F1]]; AMD's revenue grew [[F6]].", evidence: ["F1", "F6"] },
      { kind: "analyst_inference", subject: "NVDA", text: "Its pricing holds.", supports: [0] },
    ]),
    "```",
  ].join("\n");
  const requests: LlmChatRequest[] = [];
  const createClient = () => async (_deployment: unknown, request: LlmChatRequest) => {
    requests.push(request);
    return { text: request.messages[0]!.content.startsWith("You check the analyst inferences") ? '{"verdicts":[{"id":1,"verdict":"entailed","worded_amount":false}]}' : reply };
  };
  const skeleton = { id: "commentary-x", kind: "rich_text", snapshot_id: "s", data_ref: { kind: "rich_text", id: "commentary-x" }, source_refs: [], as_of: "2026-09-01T00:00:00.000Z", segments: [] };
  const answer = await answerTurn(
    { context: { userIntent: "Compare NVDA and AMD profit", bundleId: "financial_answer" }, blocks: [skeleton], toolCalls: [], packet },
    { thread_id: "t", run_id: "r", question: "Compare NVDA and AMD profit" },
    { env: { LLM_CHANNELS: "anthropic", LLM_ANTHROPIC_PROTOCOL: "anthropic", LLM_ANTHROPIC_API_KEY: "sk-test", LLM_ANTHROPIC_MODELS: "claude-sonnet-5-5,claude-haiku-5-5", LITELLM_MODEL: "anthropic/claude-sonnet-5-5", JUDGE_LITELLM_MODEL: "anthropic/claude-haiku-5-5" }, createClient },
  );
  const judged = await answer.judging!.done;

  const sent = JSON.parse(requests[0]!.messages[1]!.content) as { evidence_packet: Record<string, unknown> };
  assert.deepEqual(sent.evidence_packet, packetForModel(packet));
  assert.equal(sent.evidence_packet.route, "financial_engine");
  const asked = JSON.parse(requests[1]!.messages[1]!.content) as { inferences: Array<{ supports: string[] }> };
  const observed = "NVDA's gross margin (gross profit / revenue) was 74.40% in Q4 FY2026; AMD's year-over-year percent change in revenue was 45.74% in Q2 FY2026 vs Q2 FY2025.";
  assert.deepEqual(asked.inferences[0]!.supports, [observed]);
  const segments = judged.blocks[0]!.segments as Parameters<typeof plainText>[0];
  assert.equal(plainText(segments), `${observed}\n\n> **Analyst inference on NVDA:** Its pricing holds.`);
  assert.deepEqual(segments.filter((segment) => segment.type === "ref"), [
    { type: "ref", ref_kind: "result", ref_id: RESULT(1), format: "74.40%", period: "Q4 FY2026" },
    { type: "ref", ref_kind: "result", ref_id: RESULT(6), format: "45.74%", period: "Q2 FY2026 vs Q2 FY2025" },
  ]);
});

const LEAD = content([
  value(1, "a", "measure:m1", "period:p0", "74.40%"),
  value(2, "b", "measure:m1", "period:p1", "54.02%"),
  { ...value(3, "a", "measure:m6", "period:p7", "20.38 pp"), subject_label_id: null },
], ["a", "b"], {
  "measure:m6": { kind: "measure", text: "Difference in Gross margin (gross profit / revenue)" },
  "period:p7": { kind: "period", text: "NVIDIA Corporation Q4 FY2026 minus Advanced Micro Devices, Inc. Q2 FY2026" },
});
// Each slot's gross margin of its own reported inputs, then each lead over two of them; outputs are numbered as the results.
const leadPlan = (slots: ReadonlyArray<string>, leads: ReadonlyArray<readonly [string, string]>) => ({
  operations: [
    ...slots.flatMap((slot) => [
      { node_id: `${slot}_gp`, operation: "reported_metric", subject_slot: slot },
      { node_id: `${slot}_rev`, operation: "reported_metric", subject_slot: slot },
      { node_id: `${slot}_gm`, operation: "gross_margin", numerator: `${slot}_gp`, revenue: `${slot}_rev` },
    ]),
    ...leads.map(([left, right]) => ({ node_id: `${left}_minus_${right}`, operation: "spread", left: `${left}_gm`, right: `${right}_gm` })),
  ],
  outputs: [...slots.map((slot) => `${slot}_gm`), ...leads.map(([left, right]) => `${left}_minus_${right}`)].map((node_id, index) => ({ output_id: `out_${index + 1}`, node_id, unit_id: "u1" })),
}) as unknown as FinancialPlanV1;
const LEAD_PLAN = leadPlan(["a", "b"], [["a", "b"]]);
const HIGH = content([
  ...QUARTERS.results,
  { ...value(18, "a", "measure:m7", "period:p8", ""), presented: { kind: "ranking", text: "Q4 FY2026 has the highest revenue of the 8 quarters ranked", complete: true, order: [], leader_label_ids: ["period:q7"] } },
], ["a"], {
  ...Object.fromEntries(REVENUE.map(([period], i) => [`period:q${i}`, { kind: "period", text: period }])),
  "measure:m7": { kind: "measure", text: "Revenue ranked across periods" },
  "period:p8": { kind: "period", text: "Q1 FY2025 to Q4 FY2026" },
});
const HIGH_PLAN = {
  operations: [
    ...REVENUE.map((_, i) => ({ node_id: `revenue_q${i}`, operation: "reported_metric", subject_slot: "a" })),
    { node_id: "revenue_highest", operation: "period_rank", members: REVENUE.map((_, i) => `revenue_q${i}`), direction: "highest" },
  ],
  outputs: [...REVENUE.map((_, i) => ({ output_id: `out_${10 + i}`, node_id: `revenue_q${i}`, unit_id: "u1" })), { output_id: "out_18", node_id: "revenue_highest", unit_id: "u1" }],
} as unknown as FinancialPlanV1;

test("a lead is a figure derived from its two sides' results, and a ranking is a figure that states itself (#398)", () => {
  assert.deepEqual(enginePacket(LEAD, TICKERS, LEAD_PLAN).figures.slice(2), [{
    id: "F3",
    metric: "Difference in Gross margin (gross profit / revenue)",
    period: "NVIDIA Corporation Q4 FY2026 minus Advanced Micro Devices, Inc. Q2 FY2026",
    value: "20.38 pp",
    lead_of: ["NVDA", "AMD"],
    result_id: RESULT(3),
    source_ids: [],
  }]);
  assert.deepEqual(enginePacket(HIGH, TICKERS, HIGH_PLAN).figures.at(-1), {
    id: "F9",
    metric: "Revenue ranked across periods",
    period: "Q1 FY2025 to Q4 FY2026",
    value: "Q4 FY2026 has the highest revenue of the 8 quarters ranked",
    ranking: true,
    result_id: RESULT(18),
    source_ids: [],
  });
});

test("commentary cites a lead and a ranking by their results, and the judge reads them as supports (#398)", () => {
  const lead = enginePacket(LEAD, TICKERS, LEAD_PLAN);
  const leads = renderAssertion({ index: 0, kind: "observation", text: "x", evidence: ["F3"] }, lead, []);
  assert.equal(plainText(leads.segments), "Difference in gross margin (gross profit / revenue) was 20.38 pp in NVIDIA Corporation Q4 FY2026 minus Advanced Micro Devices, Inc. Q2 FY2026.");
  assert.deepEqual(leads.segments.filter((segment) => segment.type === "ref"), [
    { type: "ref", ref_kind: "result", ref_id: RESULT(3), format: "20.38 pp", period: "NVIDIA Corporation Q4 FY2026 minus Advanced Micro Devices, Inc. Q2 FY2026" },
  ]);
  assert.equal(resultRefProblem(prose(...leads.segments), block(LEAD)), null);
  const high = enginePacket(HIGH, TICKERS, HIGH_PLAN);
  const states = renderAssertion({ index: 0, kind: "observation", text: "x", evidence: ["F8", "F9"] }, high, []);
  assert.equal(plainText(states.segments), "NVDA's revenue was USD 62,100,000,000.00 in Q4 FY2026. Q4 FY2026 has the highest revenue of the 8 quarters ranked.");
  assert.equal(resultRefProblem(prose(...states.segments), block(HIGH)), null);

  const accepted = checkAssertions([
    { kind: "observation", text: "x", evidence: ["F3"] },
    { kind: "analyst_inference", subject: "NVDA", text: "Its pricing holds better.", supports: [0] },
  ], lead).accepted;
  const [judged] = judgeCases(accepted, lead, []);
  const trailing = checkAssertions([
    { kind: "observation", text: "x", evidence: ["F3"] },
    { kind: "analyst_inference", subject: "AMD", text: "Its pricing trails.", supports: [0] },
  ], lead);
  assert.deepEqual([trailing.accepted.map((entry) => entry.index), trailing.rejected], [[0, 1], []], "a lead is about both its companies");
  assert.deepEqual(judged!.supports, ["Difference in gross margin (gross profit / revenue) was 20.38 pp in NVIDIA Corporation Q4 FY2026 minus Advanced Micro Devices, Inc. Q2 FY2026."]);
  const [window] = judgeCases(checkAssertions([
    { kind: "observation", text: "x", evidence: ["F9"] },
    { kind: "analyst_inference", text: "Its growth has not stalled.", supports: [0] },
  ], high).accepted, high, []);
  assert.deepEqual(window!.supports, ["Q4 FY2026 has the highest revenue of the 8 quarters ranked."]);
  assert.deepEqual(renderAssertion({ index: 0, kind: "observation", text: "x", evidence: ["F9"] }, high, []).segments, [
    { type: "ref", ref_kind: "result", ref_id: RESULT(18), format: "Q4 FY2026 has the highest revenue of the 8 quarters ranked", period: "Q1 FY2025 to Q4 FY2026" },
    { type: "text", text: "." },
  ]);
  assert.match(window!.figures[0]!, /USD 62,100,000,000\.00 in Q4 FY2026\. Q4 FY2026 has the highest revenue of the 8 quarters ranked\.$/u, "the judge sees the ranking among the figures shown");
});

// NVDA's lead in gross margin over AMD and over INTC, each a figure of no one company.
const LEADS = content([
  value(1, "a", "measure:m1", "period:p0", "74.40%"),
  value(2, "b", "measure:m1", "period:p1", "54.02%"),
  value(3, "c", "measure:m1", "period:p6", "39.20%"),
  { ...value(4, "a", "measure:m6", "period:p7", "20.38 pp"), subject_label_id: null },
  { ...value(5, "a", "measure:m6", "period:p9", "35.20 pp"), subject_label_id: null },
], ["a", "b", "c"], {
  "subject:c": { kind: "subject", text: "Intel Corporation", slot_id: "c" },
  "measure:m6": { kind: "measure", text: "Difference in Gross margin (gross profit / revenue)" },
  "period:p7": { kind: "period", text: "NVIDIA Corporation Q4 FY2026 minus Advanced Micro Devices, Inc. Q2 FY2026" },
  "period:p9": { kind: "period", text: "NVIDIA Corporation Q4 FY2026 minus Intel Corporation Q3 FY2026" },
});
const LEADS_TICKERS = new Map([["a", "NVDA"], ["b", "AMD"], ["c", "INTC"]]);

test("an unknown cause never cites a lead as a change: each is two companies' figures (#398)", () => {
  const packet = enginePacket(LEADS, LEADS_TICKERS, leadPlan(["a", "b", "c"], [["a", "b"], ["a", "c"]]));
  const report = checkAssertions([
    { kind: "unknown_cause", text: "x", evidence: ["F4"] },
    { kind: "unknown_cause", text: "y", evidence: ["F4", "F5"] },
  ], packet);
  assert.deepEqual(report.rejected.map((entry) => [entry.index, entry.check]), [[0, "kind"], [1, "kind"]]);
  const window = enginePacket(HIGH, TICKERS, HIGH_PLAN);
  assert.deepEqual(checkAssertions([{ kind: "unknown_cause", text: "x", evidence: ["F9"] }], window).rejected.map((entry) => entry.check), ["kind"], "a ranking states no value that changed");
});

test("without its plan, a packet holds no lead or ranking: nothing says what either is derived from, so commentary cannot cite one (#398 review)", () => {
  const rejected = (packet: ReturnType<typeof enginePacket>, ...assertions: unknown[]) => checkAssertions(assertions, packet).rejected.map((entry) => [entry.index, entry.reason]);
  assert.deepEqual(rejected(enginePacket(LEADS, LEADS_TICKERS, null),
    { kind: "unknown_cause", text: "x", evidence: ["F4"] },
    { kind: "unknown_cause", text: "y", evidence: ["F4", "F5"] },
  ), [[0, 'unknown evidence id "F4"'], [1, 'unknown evidence id "F4"']]);
  assert.deepEqual(rejected(enginePacket(LEAD, TICKERS, null), { kind: "observation", text: "x", evidence: ["F3"] }), [[0, 'unknown evidence id "F3"']]);
  assert.deepEqual(rejected(enginePacket(HIGH, TICKERS, null), { kind: "observation", text: "x", evidence: ["F9"] }), [[0, 'unknown evidence id "F9"']]);
});

test("a peer ranking is no figure of the packet: it is no one company's (#398)", () => {
  const cohort = content([
    value(1, "a", "measure:m1", "period:p0", "74.40%"),
    value(2, "b", "measure:m1", "period:p1", "54.02%"),
    { ...value(3, "a", "measure:m7", "period:p0", ""), subject_label_id: null, presented: { kind: "ranking", text: "NVIDIA Corporation has the highest gross margin of the 2 companies ranked", complete: true, order: [], leader_label_ids: ["subject:a"] } },
  ], ["a", "b"], { "measure:m7": { kind: "measure", text: "Gross margin (gross profit / revenue) peer ranking" } });
  assert.deepEqual(enginePacket(cohort, TICKERS, leadPlan(["a", "b"], [])).figures.map((figure) => [figure.id, figure.company]), [["F1", "NVDA"], ["F2", "AMD"]]);
});
