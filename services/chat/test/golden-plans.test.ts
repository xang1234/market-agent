import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { createRuntimeAuthority, operationDependencies, type FinancialPlanV1 } from "../../financial-core/src/index.ts";
import { buildDeterministicPlan, planFinancialRequest, type PlanningContext, type PlanningModel, type PlanningResult } from "../../financial-engine/src/planner.ts";
import { createReplayLlmChatClient } from "../../llm/src/replay-client.ts";
import { isFinancialRequest, uncoveredAsks } from "../src/financial-runtime.ts";
import { resolveResearchScope, type ResearchScope } from "../src/research-scope.ts";
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
      const company = GOLDEN_COMPANIES.find((candidate) => candidate.ticker === mention)!;
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
    const period = node.period.kind === "fiscal_period" ? `${node.period.fiscal_period} ${node.period.fiscal_year}` : `latest ${node.period.period_type}[${node.period.offset}]`;
    return `${ticker(node.subject_slot)} ${node.metric_key} ${period}`;
  };
  return plan.outputs.map((output) => describe(output.node_id));
}

function summary(result: PlanningResult) {
  if (result.outcome === "ready") return { outcome: result.outcome, model_calls: result.model_calls, outputs: outputLabels(result.plan) };
  if (result.outcome === "unsupported") return { outcome: result.outcome, model_calls: result.model_calls, reason: result.reason };
  return { outcome: result.outcome, model_calls: result.model_calls };
}

const SEGMENTS = { outcome: "unsupported", model_calls: 1, reason: "segment revenue has no approved definition" } as const;
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

// The engine's turn scope, as local-runtime resolves it: the model's reading
// of the question over the companies it names, its metrics served.
function engineScope(question: string, proposal: ReturnType<typeof parseProposal>, prior: ResearchScope | null = null): ResearchScope {
  const companies = extractSubjectMentions(question).map((mention) => ({ issuer_id: GOLDEN_COMPANIES.find((company) => company.ticker === mention)!.issuer_id }));
  return resolveResearchScope({ question, companies, prior, asOf: GOLDEN_AS_OF, served: true, proposal });
}

const reading = (asks: string[], metrics: unknown[] = []) =>
  parseProposal(JSON.stringify({ metrics, asks, turns_off: { facets: [], metrics: [] }, income_items: [] }));

test("each golden answer names what its question asks for and its plan does not compute", async () => {
  const client = await createReplayLlmChatClient(REPLIES);
  const reply = async (content: string) => (await client({} as never, { messages: [{ role: "user", content }] })).text;
  const model: PlanningModel = async ({ messages }) => ({ text: (await client({} as never, { messages })).text, model: "recorded" });
  const uncovered: Record<string, string[]> = {
    "Why did AMD's operating margin turn negative in Q2 2025?": ["the cause of these figures"],
    "What was AMD's revenue in Q2 2019?": [],
    "What is AMD's free cash flow?": [],
    "Compare NVDA, AMD and AAPL revenue and margins YTD against the S&P 500": ["a stock price return over the year to date", "a comparison with a benchmark index"],
  };
  for (const [question, expected] of Object.entries(uncovered)) {
    const planned = await planFinancialRequest(planningContext(question), question, model);
    assert.equal(planned.outcome, "ready", question);
    if (planned.outcome !== "ready") continue;
    assert.deepEqual(uncoveredAsks(engineScope(question, parseProposal(await reply(proposalQuestion(question)))), planned.plan), expected, question);
  }
});

test("an engine answer names only what its own question asks for, against the figures the plan computes", () => {
  const quarter = (fiscal_period: string) => ({ kind: "fiscal_period", fiscal_year: 2026, fiscal_period });
  const reported = (node_id: string, metric_key: string, period: object) => ({ node_id, operation: "reported_metric", subject_slot: "a", metric_key, period });
  const margin = (suffix: string, period: object) => [
    reported(`oi_${suffix}`, "operating_income", period),
    reported(`rev_${suffix}`, "revenue", period),
    { node_id: `om_${suffix}`, operation: "operating_margin", numerator: `oi_${suffix}`, revenue: `rev_${suffix}` },
  ];
  const plan = (operations: object[]): FinancialPlanV1 => {
    const outputs = operations.map((operation) => ({ output_id: `out_${(operation as { node_id: string }).node_id}`, node_id: (operation as { node_id: string }).node_id }));
    const planned = buildDeterministicPlan(planningContext("NVDA"), { subjects: [{ slot_id: "a", mention: "NVDA" }], operations, outputs, thresholds: [] });
    assert.equal(planned.outcome, "ready", JSON.stringify(planned));
    return (planned as Extract<PlanningResult, { outcome: "ready" }>).plan;
  };
  const revenue = plan([reported("rev", "revenue", quarter("Q4"))]);

  const comparison = engineScope("Compare NVDA YTD against the S&P 500 and explain why", reading(["price_window", "benchmark", "explains"]));
  assert.deepEqual(uncoveredAsks(comparison, revenue), ["a stock price return over the year to date", "a comparison with a benchmark index", "the cause of these figures"]);
  // A follow-up keeps the window, the benchmark and the cause without asking for them again.
  assert.deepEqual(uncoveredAsks(engineScope("What is NVDA's revenue?", reading([], ["income_statement"]), comparison), revenue), []);

  assert.deepEqual(uncoveredAsks(engineScope("What are NVDA's EBITDA and revenue?", reading([], ["ebitda", "income_statement"])), revenue), ["EBITDA"]);
  const trend = engineScope("How has NVDA's operating margin trended?", reading(["margins", "margin_trend"]));
  assert.deepEqual(uncoveredAsks(trend, revenue), ["a margin"]);
  assert.deepEqual(uncoveredAsks(trend, plan(margin("q4", quarter("Q4")))), ["a margin over several periods"]);
  assert.deepEqual(uncoveredAsks(trend, plan([...margin("q3", quarter("Q3")), ...margin("q4", quarter("Q4"))])), []);
  const balance = engineScope("Show NVDA's balance sheet", reading([], ["balance_sheet"]));
  assert.deepEqual(uncoveredAsks(balance, plan([reported("assets", "total_assets", quarter("Q4"))])), []);
  assert.deepEqual(uncoveredAsks(balance, revenue), ["Balance sheet"]);
});
