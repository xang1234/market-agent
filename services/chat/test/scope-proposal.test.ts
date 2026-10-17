import assert from "node:assert/strict";
import test from "node:test";

import { requestedMetrics, resolveResearchScope } from "../src/research-scope.ts";
import { withDeadlines } from "../src/llm-runtime.ts";
import { parseProposal, proposeQuestionMetrics, SCOPE_DEADLINES, scopeProposalEnabled } from "../src/scope-proposal.ts";

const ENV = {
  LLM_CHANNELS: "openai",
  LLM_OPENAI_PROTOCOL: "openai",
  LLM_OPENAI_MODELS: "gpt-4.1",
  LITELLM_MODEL: "openai/gpt-4.1",
};
const NVDA = { issuer_id: "60000000-0000-4000-8000-000000000001", label: "NVDA" };
const AS_OF = "2026-09-01T00:00:00.000Z";

const replying = (text: string) => () => async () => ({ text });

test("a proposal names its metrics exactly as the patterns would", () => {
  const proposed = parseProposal(JSON.stringify({ metrics: [
    { metric: "eps_diluted", adjustment: "adjusted", qualifier: null },
    { metric: "free_cash_flow", adjustment: null, qualifier: "growth" },
    { metric: "operating_cash_flow" },
  ] }));
  assert.deepEqual(proposed, [
    ...requestedMetrics("adjusted EPS"),
    ...requestedMetrics("free cash flow growth"),
    ...requestedMetrics("operating cash flow"),
  ]);
});

test("a proposal outside the catalog is refused whole, so the patterns answer", () => {
  for (const reply of [
    '{"metrics":[{"metric":"price_to_book"}]}',
    '{"metrics":[{"metric":"eps_diluted","adjustment":"street"}]}',
    '{"metrics":[{"metric":"eps_diluted","qualifier":"forecast"}]}',
    '{"metrics":[{"metric":"free_cash_flow"},{"metric":42}]}',
    '{"metric":"free_cash_flow"}',
    "free cash flow",
    `{"metrics":${JSON.stringify(Array.from({ length: 11 }, () => ({ metric: "capex" })))}}`,
  ]) {
    assert.equal(parseProposal(reply), null, reply);
  }
});

test("an adjusted income figure is the non-GAAP gap, never the reported income statement", () => {
  for (const adjustment of ["adjusted", "non_gaap", "pro_forma"]) {
    assert.deepEqual(
      parseProposal(JSON.stringify({ metrics: [{ metric: "income_statement", adjustment }] })),
      requestedMetrics("non-GAAP operating income"),
      adjustment,
    );
  }
  // Unadjusted, it is the reported figures.
  assert.deepEqual(parseProposal('{"metrics":[{"metric":"income_statement","qualifier":"growth"}]}'), requestedMetrics("revenue"));
});

test("a margin the model reads as a metric's qualifier asks for no income margins", () => {
  const question = "What was the margin on the cash NVDA's business threw off?";
  const scope = resolveResearchScope({
    question,
    companies: [NVDA],
    prior: null,
    asOf: AS_OF,
    proposedMetrics: parseProposal('{"metrics":[{"metric":"operating_cash_flow","qualifier":"margin"}]}'),
  });
  assert.equal(scope.route, "unavailable_metric");
  assert.equal(scope.margins, false);
  // Margins the model reads as income figures are still income margins.
  const both = resolveResearchScope({
    question: "Show NVDA's free cash flow margin and its gross margin trend",
    companies: [NVDA],
    prior: null,
    asOf: AS_OF,
    proposedMetrics: parseProposal('{"metrics":[{"metric":"free_cash_flow","qualifier":"margin"},{"metric":"income_statement"}]}'),
  });
  assert.equal(both.margins, true);
  assert.equal(both.margin_trend, true);
});

test("a metric the turn turns off stays off, even when the model names it", () => {
  const prior = resolveResearchScope({ question: "Show NVDA's operating cash flow and capex", companies: [NVDA], prior: null, asOf: AS_OF });
  const next = resolveResearchScope({
    question: "Drop capex",
    companies: [NVDA],
    prior,
    asOf: AS_OF,
    proposedMetrics: parseProposal('{"metrics":[{"metric":"capex"}]}'),
  });
  assert.deepEqual(next.metrics.map((metric) => metric.metric_key), ["operating_cash_flow"]);
});

test("an unavailable metric stays the named gap it is, whatever its qualifiers", () => {
  assert.deepEqual(parseProposal('{"metrics":[{"metric":"ebitda","qualifier":"margin"}]}'), requestedMetrics("EBITDA"));
});

test("a reply wrapped in prose or a fence is read; an empty list is an answer", () => {
  assert.deepEqual(parseProposal('Sure:\n```json\n{"metrics":[{"metric":"capex"}]}\n```'), requestedMetrics("capex"));
  assert.deepEqual(parseProposal('{"metrics":[]}'), []);
  assert.deepEqual(parseProposal('{"metrics":[{"metric":"capex"},{"metric":"capex","qualifier":null}]}'), requestedMetrics("capex"));
});

test("the model reads a phrasing the patterns miss, and the scope routes on it", async () => {
  const question = "How did the cash NVDA's business threw off compare with its outlays on plant?";
  // The patterns find nothing here.
  assert.deepEqual(requestedMetrics(question), []);
  const proposed = await proposeQuestionMetrics({
    question,
    env: ENV,
    createClient: replying('{"metrics":[{"metric":"operating_cash_flow"},{"metric":"capex"}]}'),
  });
  assert.deepEqual(proposed?.map((metric) => metric.metric_key), ["operating_cash_flow", "capex"]);
  const scope = resolveResearchScope({ question, companies: [NVDA], prior: null, asOf: AS_OF, proposedMetrics: proposed });
  assert.equal(scope.route, "statements");
  assert.deepEqual(scope.metrics.map((metric) => metric.metric_key), ["operating_cash_flow", "capex"]);
});

test("the model sees the catalog and only the question", async () => {
  let seen: Array<{ role: string; content: string }> = [];
  await proposeQuestionMetrics({
    question: "What was NVDA's capex?",
    env: ENV,
    createClient: () => async (_deployment, request) => {
      seen = request.messages.map((message) => ({ role: message.role, content: String(message.content) }));
      return { text: '{"metrics":[]}' };
    },
  });
  assert.deepEqual(seen.map((message) => message.role), ["system", "user"]);
  assert.equal(seen[1]!.content, "What was NVDA's capex?");
  for (const key of ["free_cash_flow", "eps_basic", "balance_sheet", "income_statement"]) assert.match(seen[0]!.content, new RegExp(`- ${key}:`));
});

test("the proposal runs on EXTRACTION_LITELLM_MODEL when one is set", async () => {
  const models: string[] = [];
  await proposeQuestionMetrics({
    question: "What was NVDA's capex?",
    env: { ...ENV, LLM_OPENAI_MODELS: "gpt-4.1,gpt-4.1-mini", EXTRACTION_LITELLM_MODEL: "openai/gpt-4.1-mini" },
    createClient: () => async (deployment) => {
      models.push(`${deployment.channel}/${deployment.model}`);
      return { text: '{"metrics":[]}' };
    },
  });
  assert.deepEqual(models, ["openai/gpt-4.1-mini"]);
});

test("a failure, a cut-off reply, no model, or recorded replies leave the metrics to the patterns", async (t) => {
  t.mock.method(console, "warn", () => {});
  const failing = () => async () => {
    throw new Error("provider down");
  };
  assert.equal(await proposeQuestionMetrics({ question: "NVDA capex", env: ENV, createClient: failing }), null);
  assert.equal(
    await proposeQuestionMetrics({ question: "NVDA capex", env: ENV, createClient: () => async () => ({ text: '{"metrics":[', truncated: true }) }),
    null,
  );
  assert.equal(await proposeQuestionMetrics({ question: "NVDA capex", env: {}, createClient: replying('{"metrics":[]}') }), null);
  let called = false;
  const recorded = await proposeQuestionMetrics({
    question: "NVDA capex",
    env: { ...ENV, LLM_REPLAY_FILE: "/tmp/replies.json" },
    createClient: () => async () => {
      called = true;
      return { text: '{"metrics":[]}' };
    },
  });
  assert.equal(recorded, null);
  assert.equal(called, false);
  assert.equal(scopeProposalEnabled({ CHAT_SCOPE_PROPOSAL: "off" }), false);
  assert.equal(scopeProposalEnabled({}), true);
});

test("the proposal gets one attempt: the turn waits on it, so a slow model falls back to the patterns", () => {
  assert.equal(withDeadlines(SCOPE_DEADLINES).maxAttempts, 1);
});

test("without a proposal the scope reads metrics by pattern, as before", () => {
  const question = "What is NVDA's free cash flow?";
  const byPattern = resolveResearchScope({ question, companies: [NVDA], prior: null, asOf: AS_OF });
  const withNull = resolveResearchScope({ question, companies: [NVDA], prior: null, asOf: AS_OF, proposedMetrics: null });
  assert.deepEqual(withNull, byPattern);
  // An empty proposal is an answer: the question names no metric, so a follow-up keeps the last ones.
  const prior = byPattern;
  const followUp = resolveResearchScope({ question: "And why is that?", companies: [NVDA], prior, asOf: AS_OF, proposedMetrics: [] });
  assert.deepEqual(followUp.metrics.map((metric) => metric.metric_key), ["free_cash_flow"]);
});
