import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { createRuntimeAuthority, operationDependencies, type FinancialPlanV1 } from "../../financial-core/src/index.ts";
import { buildDeterministicPlan, planFinancialRequest, type PlanningContext, type PlanningModel, type PlanningResult } from "../../financial-engine/src/planner.ts";
import { createReplayLlmChatClient } from "../../llm/src/replay-client.ts";
import { isFinancialRequest, uncoveredAsks } from "../src/financial-runtime.ts";
import { parseProposal, proposalQuestion } from "../src/scope-proposal.ts";
import { extractSubjectMentions } from "../src/subject-extraction.ts";
import { GOLDEN_AS_OF, GOLDEN_COMPANIES } from "./golden/dataset.ts";

const REPLIES = join(import.meta.dirname, "golden", "llm-replies.json");

const authority = createRuntimeAuthority({
  owner_user_id: "10000000-0000-4000-8000-000000000001",
  egress_channel: "chat",
  parent: { kind: "chat_thread", id: "65000000-0000-4000-8000-0000000000d1", version: "turn:golden-plans" },
  allowed_source_classes: ["sec_filing"],
  feature: { surface: "chat", capability: "financial-answer", mode: "enforce" },
  approval_state: "not_required",
  lease: null,
});

function planningContext(question: string): PlanningContext {
  return {
    plan_id: "65000000-0000-4000-8000-0000000000d2",
    origin: { kind: "chat_request", ref: "chat:golden-plans" },
    knowledge_cutoff: GOLDEN_AS_OF,
    cutoff_timezone: "UTC",
    reporting_basis: "as_reported",
    freshness_max_age_days: null,
    authority,
    parent_limits: {},
    max_model_calls: 2,
    requested_subjects: extractSubjectMentions(question).map((mention) => {
      // AMDX names two more AMD listings (golden-conversation.test.ts).
      const company = GOLDEN_COMPANIES.find((candidate) => candidate.ticker === (mention === "AMDX" ? "AMD" : mention))!;
      return { mention, resolution: { status: "resolved", subject_ref: { kind: "issuer", id: company.issuer_id }, label: company.legal_name } };
    }),
    publication_unit_kind: "chat_section",
  };
}

function outputLabels(plan: FinancialPlanV1): string[] {
  const nodes = new Map(plan.operations.map((node) => [node.node_id, node]));
  const ticker = (slot: string) => {
    const member = plan.subjects.members.find((candidate) => candidate.slot_id === slot)!;
    return GOLDEN_COMPANIES.find((company) => company.issuer_id === member.subject_ref.id)!.ticker;
  };
  const describe = (nodeId: string): string => {
    const node = nodes.get(nodeId)!;
    if (node.operation !== "reported_metric") return `${node.operation}(${operationDependencies(node).map(describe).join(", ")})`;
    const period = node.period.kind === "fiscal_period" ? `${node.period.fiscal_period} ${node.period.fiscal_year}` : node.period.kind === "latest" ? `latest ${node.period.period_type}[${node.period.offset}]` : node.period.kind;
    return `${ticker(node.subject_slot)} ${node.metric_key} ${period}`;
  };
  return plan.outputs.map((output) => describe(output.node_id));
}

function summary(result: PlanningResult) {
  if (result.outcome === "ready") return { outcome: result.outcome, model_calls: result.model_calls, outputs: outputLabels(result.plan) };
  if (result.outcome === "unsupported") return { outcome: result.outcome, model_calls: result.model_calls, reason: result.reason };
  return { outcome: result.outcome, model_calls: result.model_calls };
}

const SEGMENTS = { outcome: "unsupported", model_calls: 1, reason: "segments" } as const;
const latestMargins = (ticker: string) => {
  const metric = (key: string) => `${ticker} ${key} latest annual[0]`;
  return [
    metric("revenue"),
    `gross_margin(${metric("gross_profit")}, ${metric("revenue")})`,
    `operating_margin(${metric("operating_income")}, ${metric("revenue")})`,
    `net_margin(${metric("net_income")}, ${metric("revenue")})`,
  ];
};

const EXPECTED: Record<string, ReturnType<typeof summary>> = {
  "Break down NVDA's revenue by segment": SEGMENTS,
  "Why did AMD's operating margin turn negative in Q2 2025?": {
    outcome: "ready",
    model_calls: 1,
    outputs: ["operating_margin(AMD operating_income Q2 2025, AMD revenue Q2 2025)"],
  },
  "What was AMD's revenue in Q2 2019?": { outcome: "ready", model_calls: 1, outputs: ["AMD revenue Q2 2019"] },
  "Break down AMD's revenue by segment": SEGMENTS,
  "Break down NVDA's revenue by segment and show its operating margin trend": SEGMENTS,
  "Break down NVDA's revenue by segment and show its gross margin": SEGMENTS,
  "What is AMD's free cash flow?": {
    outcome: "ready",
    model_calls: 1,
    outputs: [
      "AMD operating_cash_flow latest annual[0]",
      "AMD capex latest annual[0]",
      "free_cash_flow(AMD operating_cash_flow latest annual[0], AMD capex latest annual[0])",
    ],
  },
  "Compare NVDA, AMD and AAPL revenue and margins YTD against the S&P 500": {
    outcome: "ready",
    model_calls: 1,
    outputs: [...latestMargins("NVDA"), ...latestMargins("AMD"), ...latestMargins("AAPL")],
  },
  "What drives AAPL's margins?": { outcome: "ready", model_calls: 1, outputs: latestMargins("AAPL").slice(1) },
  "How does AMDX's Q2 2025 revenue compare with its peers?": { outcome: "ready", model_calls: 1, outputs: ["AMD revenue Q2 2025"] },
};

test("each golden metric question plans from its own recorded reply on the first call", async () => {
  const questions = (JSON.parse(readFileSync(REPLIES, "utf8")) as { replies: Array<{ match: string }> }).replies
    .flatMap((reply) => /^Question: "(.*)"$/u.exec(reply.match)?.[1] ?? [])
    .filter(isFinancialRequest);
  assert.deepEqual(questions, Object.keys(EXPECTED), "the golden questions that reach the financial lane");

  const client = await createReplayLlmChatClient(REPLIES);
  const model: PlanningModel = async ({ messages }) => ({ text: (await client({} as never, { messages })).text, model: "recorded" });
  for (const question of questions) {
    assert.deepEqual(summary(await planFinancialRequest(planningContext(question), question, model)), EXPECTED[question], question);
  }
});

const reading = (asks: string[], metrics: unknown[] = [], income_items: string[] = [], turnsOff: string[] = []) =>
  parseProposal(JSON.stringify({ metrics, asks, turns_off: { facets: turnsOff, metrics: [] }, income_items }))!;

test("each golden answer names what its question asks for and its plan does not compute", async () => {
  const client = await createReplayLlmChatClient(REPLIES);
  const reply = async (content: string) => (await client({} as never, { messages: [{ role: "user", content }] })).text;
  const model: PlanningModel = async ({ messages }) => ({ text: (await client({} as never, { messages })).text, model: "recorded" });
  const uncovered: Record<string, string[]> = {
    "Why did AMD's operating margin turn negative in Q2 2025?": ["the cause of these figures"],
    "What was AMD's revenue in Q2 2019?": [],
    "What is AMD's free cash flow?": [],
    "Compare NVDA, AMD and AAPL revenue and margins YTD against the S&P 500": ["a stock price return", "a comparison with a benchmark index"],
    "What drives AAPL's margins?": ["the cause of these figures"],
    "How does AMDX's Q2 2025 revenue compare with its peers?": ["peers the question did not name"],
  };
  for (const [question, expected] of Object.entries(uncovered)) {
    const planned = await planFinancialRequest(planningContext(question), question, model);
    assert.equal(planned.outcome, "ready", question);
    if (planned.outcome !== "ready") continue;
    assert.deepEqual(uncoveredAsks(parseProposal(await reply(proposalQuestion(question)))!, planned.plan), expected, question);
  }
});

test("an engine answer names what the reading of its question asks for and the plan does not compute", () => {
  const quarter = (fiscal_period: string) => ({ kind: "fiscal_period", fiscal_year: 2026, fiscal_period });
  const reported = (node_id: string, metric_key: string, period: object) => ({ node_id, operation: "reported_metric", subject_slot: "a", metric_key, period });
  const margin = (suffix: string, period: object) => [
    reported(`oi_${suffix}`, "operating_income", period),
    reported(`rev_${suffix}`, "revenue", period),
    { node_id: `om_${suffix}`, operation: "operating_margin", numerator: `oi_${suffix}`, revenue: `rev_${suffix}` },
  ];
  const plan = (operations: object[], shown: string[] = operations.map((operation) => (operation as { node_id: string }).node_id)): FinancialPlanV1 => {
    const outputs = shown.map((node_id) => ({ output_id: `out_${node_id}`, node_id }));
    const planned = buildDeterministicPlan(planningContext("NVDA"), { subjects: [{ slot_id: "a", mention: "NVDA" }], operations, outputs, thresholds: [] });
    assert.equal(planned.outcome, "ready", JSON.stringify(planned));
    return (planned as Extract<PlanningResult, { outcome: "ready" }>).plan;
  };
  const revenue = plan([reported("rev", "revenue", quarter("Q4"))]);

  assert.deepEqual(uncoveredAsks(reading(["price_window", "benchmark", "explains"]), revenue), ["a stock price return", "a comparison with a benchmark index", "the cause of these figures"]);
  assert.deepEqual(uncoveredAsks(reading([], ["income_statement"], ["revenue"]), revenue), [], "revenue YTD asks for no stock price return");
  assert.deepEqual(uncoveredAsks(reading(["benchmark"], [], [], ["benchmark"]), revenue), [], "a facet the question turns off is not asked for");

  assert.deepEqual(uncoveredAsks(reading([], ["ebitda", "income_statement"]), revenue), ["EBITDA"]);
  assert.deepEqual(uncoveredAsks(reading([], ["income_statement"], ["revenue", "net_income", "operating_expenses"]), revenue), ["net income", "operating expenses"]);
  assert.deepEqual(uncoveredAsks(reading(["margins"], ["income_statement"]), revenue), ["a margin"]);
  const trend = reading(["margins", "margin_trend"], ["income_statement"]);
  assert.deepEqual(uncoveredAsks(trend, revenue), ["a margin over several periods"]);
  assert.deepEqual(uncoveredAsks(trend, plan(margin("q4", quarter("Q4")))), ["a margin over several periods"]);
  assert.deepEqual(uncoveredAsks(trend, plan([...margin("q3", quarter("Q3")), ...margin("q4", quarter("Q4"))])), []);

  const assets = plan([reported("assets", "total_assets", quarter("Q4"))]);
  assert.deepEqual(uncoveredAsks(reading([], ["balance_sheet"]), assets), ["cash and equivalents", "total liabilities", "stockholders' equity"]);
  assert.deepEqual(uncoveredAsks(reading([], ["total_assets"]), assets), []);

  const marginOnly = plan(margin("q4", quarter("Q4")), ["om_q4"]);
  assert.deepEqual(uncoveredAsks(reading(["margins"], ["income_statement"], ["revenue", "operating_income"]), marginOnly), ["revenue", "operating income"], "an input the answer does not show is named, a margin's numerator too (#425)");
  assert.deepEqual(uncoveredAsks(reading(["margins"], ["income_statement"], ["operating_margin"]), marginOnly), [], "the margin answers its own item");
  assert.deepEqual(uncoveredAsks(reading(["margins"], ["income_statement"], ["net_margin"]), marginOnly), ["net margin"], "one margin does not answer another");
  const turnsOff = (asks: string[], metrics: unknown[], facets: string[], offMetrics: unknown[]) =>
    parseProposal(JSON.stringify({ metrics, asks, turns_off: { facets, metrics: offMetrics }, income_items: [] }))!;
  assert.deepEqual(uncoveredAsks(turnsOff(["margins", "margin_trend"], [], ["margins"], []), revenue), [], "no margins is no trend");
  assert.deepEqual(uncoveredAsks(turnsOff([], ["balance_sheet"], [], [{ metric: "cash_and_equivalents" }]), assets), ["total liabilities", "stockholders' equity"]);
  assert.deepEqual(uncoveredAsks(turnsOff([], ["total_assets"], [], [{ metric: "balance_sheet" }]), revenue), []);
  assert.deepEqual(uncoveredAsks(reading([], ["balance_sheet", "total_assets"]), revenue), ["cash and equivalents", "total assets", "total liabilities", "stockholders' equity"]);
  const cashFlow = plan([reported("ocf", "operating_cash_flow", quarter("FY"))]);
  assert.deepEqual(uncoveredAsks(reading([], ["income_statement"], ["revenue"]), cashFlow), ["revenue"]);
  assert.deepEqual(uncoveredAsks(reading(["margins"], ["income_statement"], ["gross_margin"]), revenue), ["gross margin"]);
});

test("an engine answer names what it leaves out for each company it covers (#425)", () => {
  const q4 = { kind: "fiscal_period", fiscal_year: 2026, fiscal_period: "Q4" };
  const reported = (node_id: string, subject_slot: string, metric_key: string) => ({ node_id, operation: "reported_metric", subject_slot, metric_key, period: q4 });
  const planned = buildDeterministicPlan(planningContext("NVDA and AMD"), {
    subjects: [{ slot_id: "a", mention: "NVDA" }, { slot_id: "b", mention: "AMD" }],
    operations: [
      reported("a_oi", "a", "operating_income"),
      reported("a_rev", "a", "revenue"),
      { node_id: "a_om", operation: "operating_margin", numerator: "a_oi", revenue: "a_rev" },
      reported("b_rev", "b", "revenue"),
    ],
    outputs: ["a_rev", "a_om", "b_rev"].map((node_id) => ({ output_id: `out_${node_id}`, node_id })),
    thresholds: [],
  });
  assert.equal(planned.outcome, "ready", JSON.stringify(planned));
  const plan = (planned as Extract<PlanningResult, { outcome: "ready" }>).plan;
  const ticker = (symbol: string) => GOLDEN_COMPANIES.find((company) => company.ticker === symbol)!.issuer_id;
  const labels = new Map([[ticker("NVDA"), "NVDA"], [ticker("AMD"), "AMD"]]);

  assert.deepEqual(uncoveredAsks(reading(["margins"], ["income_statement"], ["revenue", "operating_margin"]), plan, labels), ["operating margin for AMD"]);
  assert.deepEqual(uncoveredAsks(reading(["margins"], ["income_statement"]), plan, labels), ["a margin for AMD"]);
  assert.deepEqual(uncoveredAsks(reading(["benchmark"], ["income_statement"], ["net_income"]), plan, labels), ["net income", "a comparison with a benchmark index"], "an ask no company's figures answer names no company");
});

test("an engine answer checks a qualified metric against what its plan computes (#425)", () => {
  const year = (fiscal_year: number) => ({ kind: "fiscal_period", fiscal_year, fiscal_period: "FY" });
  const eps = (node_id: string, fiscal_year: number) => ({ node_id, operation: "reported_metric", subject_slot: "a", metric_key: "eps_diluted", period: year(fiscal_year) });
  const plan = (operations: object[], shown: string[]): FinancialPlanV1 => {
    const planned = buildDeterministicPlan(planningContext("NVDA"), { subjects: [{ slot_id: "a", mention: "NVDA" }], operations, outputs: shown.map((node_id) => ({ output_id: `out_${node_id}`, node_id })), thresholds: [] });
    assert.equal(planned.outcome, "ready", JSON.stringify(planned));
    return (planned as Extract<PlanningResult, { outcome: "ready" }>).plan;
  };
  const latest = plan([eps("e26", 2026)], ["e26"]);
  const twoYears = plan([eps("e25", 2025), eps("e26", 2026)], ["e25", "e26"]);
  const growth = plan([eps("e25", 2025), eps("e26", 2026), { node_id: "g", operation: "percent_change_positive_base", current: "e26", prior: "e25" }], ["g"]);
  const asked = (metric: object) => reading([], [metric]);

  assert.deepEqual(uncoveredAsks(asked({ metric: "eps_diluted", qualifier: "growth" }), latest), ["earnings per share growth"]);
  assert.deepEqual(uncoveredAsks(asked({ metric: "eps_diluted", qualifier: "growth" }), growth), [], "a change of the figure is its growth");
  assert.deepEqual(uncoveredAsks(asked({ metric: "eps_diluted", qualifier: "trend" }), latest), ["earnings per share trend"]);
  assert.deepEqual(uncoveredAsks(asked({ metric: "eps_diluted", qualifier: "trend" }), twoYears), [], "two periods of the figure are its trend");
  assert.deepEqual(uncoveredAsks(asked({ metric: "eps_diluted", adjustment: "adjusted" }), growth), ["adjusted earnings per share"], "an engine figure is as reported");
  assert.deepEqual(uncoveredAsks(asked({ metric: "free_cash_flow", qualifier: "margin" }), growth), ["free cash flow margin"]);
  assert.deepEqual(uncoveredAsks(asked({ metric: "eps_basic", qualifier: "growth" }), growth), ["basic earnings per share growth"], "diluted EPS is not basic EPS");
});
