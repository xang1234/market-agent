import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { withDeadlines } from "../src/llm-runtime.ts";
import { parseProposal, proposalQuestion, proposeScope, SCOPE_DEADLINES } from "../src/scope-proposal.ts";

const ENV = {
  LLM_CHANNELS: "openai",
  LLM_OPENAI_PROTOCOL: "openai",
  LLM_OPENAI_MODELS: "gpt-4.1",
  LITELLM_MODEL: "openai/gpt-4.1",
};
const EMPTY = { metrics: [], asks: [], turns_off: { facets: [], metrics: [] }, income_items: [], period: { kind: "latest" } };
const reply = (fields: Record<string, unknown>) => JSON.stringify({ ...EMPTY, ...fields });
const replying = (text: string) => () => async () => ({ text });

test("a full reply is read into the proposal, each metric built from the catalog", () => {
  assert.deepEqual(parseProposal(reply({
    metrics: [
      { metric: "eps_diluted", adjustment: "adjusted", qualifier: null },
      { metric: "free_cash_flow", adjustment: null, qualifier: "growth" },
      { metric: "income_statement" },
    ],
    asks: ["guidance", "explains", "guidance"],
    turns_off: { facets: ["segments", "fiscal_quarter"], metrics: [{ metric: "capex" }, { metric: "eps_diluted", adjustment: "non_gaap" }] },
    income_items: ["revenue", "operating_income", "revenue"],
    period: { kind: "fiscal_year", fiscal_year: 2025 },
  })), {
    metrics: [
      { metric_key: "eps_diluted_adjusted", label: "Adjusted earnings per share", available: false, base: "eps_diluted", adjustment: "adjusted" },
      { metric_key: "free_cash_flow_growth", label: "Free cash flow growth", available: false, base: "free_cash_flow", qualifier: "growth" },
      { metric_key: "income_statement", label: "Revenue, profit and margins", available: true },
    ],
    asks: new Set(["guidance", "explains"]),
    turns_off: { facets: new Set(["segments", "fiscal_quarter"]), metrics: new Set(["capex", "eps_diluted_non_gaap"]) },
    income_items: ["revenue", "operating_income"],
    period: { kind: "fiscal_year", fiscal_year: 2025 },
  });
});

test("each kind of period is read with exactly its fields (#472)", () => {
  for (const period of [
    { kind: "latest" },
    { kind: "fiscal_year", fiscal_year: 2024 },
    { kind: "fiscal_quarter", fiscal_period: "Q3", fiscal_year: 2025 },
    { kind: "fiscal_quarter", fiscal_period: "Q3", fiscal_year: null },
    { kind: "trailing_twelve_months" },
    { kind: "range" },
    { kind: "other" },
  ]) {
    assert.deepEqual(parseProposal(reply({ period }))?.period, period, JSON.stringify(period));
  }
  for (const period of [
    { kind: "next_year" },
    { kind: "fiscal_year", fiscal_year: 2024.5 },
    { kind: "fiscal_year", fiscal_year: 1989 },
    { kind: "fiscal_year", fiscal_year: 2101 },
    { kind: "fiscal_year", fiscal_year: "2024" },
    { kind: "fiscal_year" },
    { kind: "fiscal_quarter", fiscal_period: "Q5", fiscal_year: 2025 },
    { kind: "fiscal_quarter", fiscal_period: "Q3" },
    { kind: "latest", fiscal_year: 2025 },
    { kind: "range", from: 2021 },
    { kind: "fiscal_year", fiscal_year: 2024, fiscal_period: "Q1" },
    "latest",
    null,
  ]) {
    assert.equal(parseProposal(reply({ period })), null, JSON.stringify(period));
  }
  const { period: _period, ...noPeriod } = EMPTY;
  assert.equal(parseProposal(JSON.stringify(noPeriod)), null, "no period");
});

test("a metric to turn off may be its bare catalog key (#378 eval)", () => {
  assert.deepEqual(parseProposal(reply({ turns_off: { facets: [], metrics: ["capex", { metric: "free_cash_flow" }] } }))?.turns_off.metrics, new Set(["capex", "free_cash_flow"]));
  assert.equal(parseProposal(reply({ turns_off: { facets: [], metrics: ["price_to_book"] } })), null);
});

test("anything outside the vocabularies, or malformed, refuses the whole proposal", () => {
  for (const text of [
    // A facet, period, metric, adjustment, qualifier or item outside them.
    reply({ asks: ["valuation"] }),
    reply({ asks: ["fiscal_year"] }),
    reply({ turns_off: { facets: ["companies"], metrics: [] } }),
    reply({ metrics: [{ metric: "price_to_book" }] }),
    reply({ turns_off: { facets: [], metrics: [{ metric: "price_to_book" }] } }),
    reply({ metrics: [{ metric: "eps_diluted", adjustment: "street" }] }),
    reply({ metrics: [{ metric: "eps_diluted", qualifier: "forecast" }] }),
    reply({ income_items: ["ebitda"] }),
    // Malformed.
    reply({ metrics: [{ metric: "free_cash_flow" }, { metric: 42 }] }),
    reply({ metrics: Array.from({ length: 11 }, () => ({ metric: "capex" })) }),
    reply({ asks: "guidance" }),
    reply({ turns_off: null }),
    JSON.stringify({ metrics: [], asks: [], income_items: [] }),
    '{"metrics":[{"metric":"capex"}]',
    "free cash flow",
  ]) {
    assert.equal(parseProposal(text), null, text);
  }
});

test("an adjusted income figure is the non-GAAP gap; an unavailable metric stays the gap it is", () => {
  const nonGaap = { metric_key: "non_gaap_income", label: "Non-GAAP earnings", available: false };
  for (const adjustment of ["adjusted", "non_gaap", "pro_forma"]) {
    assert.deepEqual(parseProposal(reply({ metrics: [{ metric: "income_statement", adjustment }] }))?.metrics, [nonGaap], adjustment);
  }
  assert.deepEqual(parseProposal(reply({ metrics: [{ metric: "ebitda", qualifier: "margin" }] }))?.metrics, [
    { metric_key: "ebitda", label: "EBITDA", available: false },
  ]);
  assert.deepEqual(parseProposal(reply({ metrics: [{ metric: "free_cash_flow", qualifier: "ytd" }] }))?.metrics, [
    { metric_key: "free_cash_flow_ytd", label: "Free cash flow year to date", available: false, base: "free_cash_flow", qualifier: "ytd" },
  ]);
});

test("a reply wrapped in prose or a fence is read", () => {
  assert.deepEqual(parseProposal(`Sure:\n\`\`\`json\n${reply({ asks: ["peers"] })}\n\`\`\``), {
    metrics: [],
    asks: new Set(["peers"]),
    turns_off: { facets: new Set(), metrics: new Set() },
    income_items: [],
    period: { kind: "latest" },
  });
});

test("the model sees the vocabularies and the quoted question, and its reply is the proposal", async () => {
  let seen: Array<{ role: string; content: string }> = [];
  const proposed = await proposeScope({
    question: "How did the cash NVDA's business threw off compare with its outlays on plant?",
    env: ENV,
    createClient: () => async (_deployment, request) => {
      seen = request.messages.map((message) => ({ role: message.role, content: String(message.content) }));
      return { text: reply({ metrics: [{ metric: "operating_cash_flow" }, { metric: "capex" }] }) };
    },
  });
  assert.deepEqual(proposed?.metrics.map((metric) => metric.metric_key), ["operating_cash_flow", "capex"]);
  assert.deepEqual(seen.map((message) => message.role), ["system", "user"]);
  assert.equal(seen[1]!.content, 'Question: "How did the cash NVDA\'s business threw off compare with its outlays on plant?"');
  for (const key of ["- free_cash_flow:", "- income_statement:", "- latest_quarter:", "- evidence:", "operating_expenses", '{"kind":"trailing_twelve_months"}']) assert.ok(seen[0]!.content.includes(key), key);
});

test("the proposal runs on EXTRACTION_LITELLM_MODEL when one is set", async () => {
  const models: string[] = [];
  await proposeScope({
    question: "What was NVDA's capex?",
    env: { ...ENV, LLM_OPENAI_MODELS: "gpt-4.1,gpt-4.1-mini", EXTRACTION_LITELLM_MODEL: "openai/gpt-4.1-mini" },
    createClient: () => async (deployment) => {
      models.push(`${deployment.channel}/${deployment.model}`);
      return { text: reply({}) };
    },
  });
  assert.deepEqual(models, ["openai/gpt-4.1-mini"]);
});

test("off, no model, a failure, a cut-off or invalid reply: no proposal, and one warning naming why", async (t) => {
  const warnings: string[] = [];
  t.mock.method(console, "warn", (message: string) => warnings.push(message));
  let called = false;
  const results = [
    await proposeScope({ question: "NVDA capex", env: { ...ENV, CHAT_SCOPE_PROPOSAL: "off" }, createClient: () => async () => {
      called = true;
      return { text: reply({}) };
    } }),
    await proposeScope({ question: "NVDA capex", env: {}, createClient: replying(reply({})) }),
    await proposeScope({ question: "NVDA capex", env: ENV, createClient: () => async () => {
      throw new Error("provider down");
    } }),
    await proposeScope({ question: "NVDA capex", env: ENV, createClient: () => async () => ({ text: '{"metrics":[', truncated: true }) }),
    await proposeScope({ question: "NVDA capex", env: ENV, createClient: replying(reply({ asks: ["valuation"] })) }),
  ];
  assert.deepEqual(results, [null, null, null, null, null]);
  assert.equal(called, false);
  assert.deepEqual(warnings, [
    "[chat] no scope proposal (CHAT_SCOPE_PROPOSAL=off); the turn asks for nothing new",
    "[chat] no scope proposal (no model); the turn asks for nothing new",
    "[chat] no scope proposal (model call failed); the turn asks for nothing new",
    "[chat] no scope proposal (reply cut off); the turn asks for nothing new",
    "[chat] no scope proposal (reply outside the vocabularies); the turn asks for nothing new",
  ]);
});

test("recorded replies answer the proposal, matched by the quoted question alone", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "scope-replies-")), "replies.json");
  writeFileSync(file, JSON.stringify({ replies: [
    { match: proposalQuestion("Explain the differences and show the evidence"), text: reply({ asks: ["explains", "evidence"] }) },
    { match: proposalQuestion("Explain the differences"), text: reply({ asks: ["explains"] }) },
  ] }));
  const env = { LLM_CHANNELS: "fixture", LLM_FIXTURE_PROTOCOL: "openai", LLM_FIXTURE_MODELS: "recorded", LITELLM_MODEL: "fixture/recorded", LLM_REPLAY_FILE: file };
  const asks = async (question: string) => [...(await proposeScope({ question, env }))!.asks];
  assert.deepEqual(await asks("Explain the differences"), ["explains"]);
  assert.deepEqual(await asks("Explain the differences and show the evidence"), ["explains", "evidence"]);
});

test("the proposal gets one attempt: the turn waits on it, so a slow model asks for nothing new", () => {
  assert.equal(withDeadlines(SCOPE_DEADLINES).maxAttempts, 1);
});
