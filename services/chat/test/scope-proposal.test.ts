import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { withDeadlines } from "../src/llm-runtime.ts";
import { resolveResearchScope } from "../src/research-scope.ts";
import { parseProposal, proposalQuestion, proposeScope, SCOPE_DEADLINES } from "../src/scope-proposal.ts";

const ENV = {
  LLM_CHANNELS: "openai",
  LLM_OPENAI_PROTOCOL: "openai",
  LLM_OPENAI_MODELS: "gpt-4.1",
  LITELLM_MODEL: "openai/gpt-4.1",
};
const EMPTY = { metrics: [], asks: [], turns_off: { facets: [], metrics: [] }, income_items: [], period: { kind: "none" }, companies: { kind: "as_named", names: [] } };
const reply = (fields: Record<string, unknown>) => JSON.stringify({ ...EMPTY, ...fields });
const parse = (text: string, question = "") => parseProposal(text, question);
const replying = (text: string) => () => async () => ({ text });

test("a full reply is read into the proposal, each metric built from the catalog", () => {
  assert.deepEqual(parse(reply({
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
    companies: { kind: "as_named", names: [] },
  });
});

test("each kind of period is read with exactly its fields (#472)", () => {
  for (const period of [
    { kind: "none" },
    { kind: "latest" },
    { kind: "fiscal_year", fiscal_year: 2024 },
    { kind: "fiscal_quarter", fiscal_period: "Q3", fiscal_year: 2025 },
    { kind: "fiscal_quarter", fiscal_period: "Q3", fiscal_year: null },
    { kind: "trailing_twelve_months" },
    { kind: "range" },
    { kind: "other" },
  ]) {
    assert.deepEqual(parse(reply({ period }))?.period, period, JSON.stringify(period));
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
    assert.equal(parse(reply({ period })), null, JSON.stringify(period));
  }
  const { period: _period, ...noPeriod } = EMPTY;
  assert.equal(parse(JSON.stringify(noPeriod)), null, "no period");
});

test("each change to the companies is read with exactly its fields", () => {
  const question = "Drop AMD and add Tesla, or just AAPL? What about MSFT, GOOG and META?";
  for (const companies of [
    { kind: "as_named", names: [] },
    { kind: "as_named", names: ["AAPL", "Tesla"] },
    { kind: "compare", add: [] },
    { kind: "compare", add: ["tesla"] },
    { kind: "drop", drop: ["AMD"], add: [] },
    { kind: "drop", drop: ["AMD"], add: ["Tesla"] },
    { kind: "only", names: ["AAPL"] },
    { kind: "unclear", names: ["AAPL", "MSFT", "GOOG", "META", "AMD"] },
  ]) {
    assert.deepEqual(parse(reply({ companies }), question)?.companies, companies, JSON.stringify(companies));
  }
  for (const companies of [
    { kind: "switch", names: ["AAPL"] },
    { kind: "as_named" },
    { kind: "as_named", names: ["NVDA"] },
    { kind: "compare" },
    { kind: "compare", add: ["AMD"], drop: [] },
    { kind: "drop", drop: [], add: ["AMD"] },
    { kind: "drop", drop: ["AMD"] },
    { kind: "only", names: [] },
    { kind: "unclear", names: [] },
    { kind: "unclear", names: ["AAPL", "MSFT", "GOOG", "META", "AMD", "Tesla"] },
    { kind: "only", names: [42] },
    { kind: "only", names: [""] },
    { kind: "only", names: "AAPL" },
    "as_named",
    null,
  ]) {
    assert.equal(parse(reply({ companies }), question), null, JSON.stringify(companies));
  }
  const { companies: _companies, ...noCompanies } = EMPTY;
  assert.equal(parse(JSON.stringify(noCompanies), question), null, "no companies");
});

test("a company the question does not write refuses the whole proposal", () => {
  const read = (companies: unknown) => parse(reply({ asks: ["peers"], companies }), "Compare it with AMD");
  assert.deepEqual(read({ kind: "compare", add: ["amd"] })?.asks, new Set(["peers"]));
  assert.equal(read({ kind: "compare", add: ["AMD", "NVDA"] }), null);
  assert.equal(read({ kind: "drop", drop: ["AMD"], add: ["Advanced Micro Devices"] }), null);
  assert.equal(read({ kind: "only", names: ["AAPL"] }), null);
  assert.deepEqual(parse(reply({ companies: { kind: "compare", add: ["eBay", "iRobot"] } }), "Compare it with eBay and iRobot")?.companies, { kind: "compare", add: ["eBay", "iRobot"] }, "a capital anywhere in the first word");
  assert.deepEqual(parse(reply({ companies: { kind: "compare", add: ["AMD", "NVDA"] } }), "Compare $AMD's margins with #NVDA")?.companies, { kind: "compare", add: ["AMD", "NVDA"] }, "a cashtag or hashtag");
  const inQuestion = (name: string, question: string) => parse(reply({ companies: { kind: "compare", add: [name] } }), question) !== null;
  assert.deepEqual(
    [inQuestion("AMD", "Compare it with Amdocs"), inQuestion("a", "Compare it with AMD"), inQuestion("AMD", "Compare it with AMD's"), inQuestion("Berkshire Hathaway", "vs Berkshire  Hathaway?")],
    [false, false, true, true],
    "a name is written as whole words",
  );
  assert.deepEqual(
    [inQuestion("BRK", "Compare it with BRK.B"), inQuestion("B", "Compare it with BRK.B"), inQuestion("BF", "vs BF-B?"), inQuestion("BRK.B", "Compare it with BRK.B."), inQuestion("BF-B", "vs \"BF-B\"?")],
    [false, false, false, true, true],
    "a dotted or dashed ticker is one word",
  );
  assert.deepEqual(
    [inQuestion("it", "Compare it with AMD"), inQuestion("CASH", "Drop FREE CASH FLOW"), inQuestion("NET", "Show NET income"), inQuestion("Apple", "Compare it with Apple"), inQuestion("AMD", "Compare it with AMD")],
    [false, false, false, true, true],
    "a name is a company the question writes, not a word of a metric",
  );
  assert.deepEqual(
    [inQuestion("CASH", "Compare CASH and its free cash flow"), inQuestion("NET", "Compare NET and AMD net income")],
    [true, true],
    "a company also written outside a metric's name",
  );
});

test("a metric to turn off may be its bare catalog key (#378 eval)", () => {
  assert.deepEqual(parse(reply({ turns_off: { facets: [], metrics: ["capex", { metric: "free_cash_flow" }] } }))?.turns_off.metrics, new Set(["capex", "free_cash_flow"]));
  assert.equal(parse(reply({ turns_off: { facets: [], metrics: ["price_to_book"] } })), null);
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
    assert.equal(parse(text), null, text);
  }
});

test("an adjusted income figure is the non-GAAP gap; an unavailable metric stays the gap it is", () => {
  const nonGaap = { metric_key: "non_gaap_income", label: "Non-GAAP earnings", available: false };
  for (const adjustment of ["adjusted", "non_gaap", "pro_forma"]) {
    assert.deepEqual(parse(reply({ metrics: [{ metric: "income_statement", adjustment }] }))?.metrics, [nonGaap], adjustment);
  }
  assert.deepEqual(parse(reply({ metrics: [{ metric: "ebitda", qualifier: "margin" }] }))?.metrics, [
    { metric_key: "ebitda", label: "EBITDA", available: false },
  ]);
  assert.deepEqual(parse(reply({ metrics: [{ metric: "free_cash_flow", qualifier: "ytd" }] }))?.metrics, [
    { metric_key: "free_cash_flow_ytd", label: "Free cash flow year to date", available: false, base: "free_cash_flow", qualifier: "ytd" },
  ]);
});

test("a reply wrapped in prose or a fence is read", () => {
  assert.deepEqual(parse(`Sure:\n\`\`\`json\n${reply({ asks: ["peers"] })}\n\`\`\``), {
    metrics: [],
    asks: new Set(["peers"]),
    turns_off: { facets: new Set(), metrics: new Set() },
    income_items: [],
    period: { kind: "none" },
    companies: { kind: "as_named", names: [] },
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

test("a stock price return over any window but year to date is its own facet, and no window is recorded for it (#398)", () => {
  const question = "Compare NVDA and AMD stock over the past five years";
  const read = parseProposal(JSON.stringify({ metrics: [], asks: ["price_history"], turns_off: { facets: [], metrics: [] }, income_items: [], period: { kind: "range" }, companies: { kind: "as_named", names: ["NVDA", "AMD"] } }), question);
  assert.deepEqual([...read!.asks], ["price_history"]);
  const companies = [{ issuer_id: "60000000-0000-4000-8000-000000000001" }, { issuer_id: "60000000-0000-4000-8000-000000000002" }];
  assert.equal(resolveResearchScope({ companies, prior: null, asOf: "2026-09-01T00:00:00.000Z", proposal: read }).price_window, null);
});
