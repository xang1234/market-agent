import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { createRuntimeAuthority, operationDependencies, type FinancialPlanV1 } from "../../financial-core/src/index.ts";
import { planFinancialRequest, type PlanningContext, type PlanningModel, type PlanningResult } from "../../financial-engine/src/planner.ts";
import { createReplayLlmChatClient } from "../../llm/src/replay-client.ts";
import { isFinancialRequest } from "../src/financial-runtime.ts";
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
