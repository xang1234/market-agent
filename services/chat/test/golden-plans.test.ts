import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { createRuntimeAuthority, operationDependencies, type FinancialPlanV1 } from "../../financial-core/src/index.ts";
import { buildDeterministicPlan, planFinancialRequest, type PlanningContext, type PlanningModel, type PlanningResult, type RequestedSubject } from "../../financial-engine/src/planner.ts";
import type { CandidatePage, CandidateRequest, FinancialEvidencePort, InputCandidate } from "../../financial-engine/src/ports.ts";
import { createReplayLlmChatClient } from "../../llm/src/replay-client.ts";
import { namesCompanies, overviewSubjects, planCompanyOverview } from "../src/company-overview.ts";
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
  "Compare NVDA and AMD operating margin and EPS growth": {
    outcome: "ready",
    model_calls: 1,
    outputs: ["operating_margin(NVDA operating_income latest annual[0], NVDA revenue latest annual[0])", "AMD revenue latest annual[0]"],
  },
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

test("a company's overview shows its eight quarters to the newest it reported revenue for by the cutoff, each named by its fiscal period (#398)", async () => {
  // The SEC ingester stores a fourth quarter as the year less its first three, with no source token, so no precision proof.
  const revenue = (fiscal_year: number, fiscal_period: string, publicBy = "2026-03-01T00:00:00.000Z") => ({
    metric_key: "revenue",
    period: { start: null, end: `${fiscal_year}-${{ Q1: "03-31", Q2: "06-30", Q3: "09-30", Q4: "12-31", FY: "12-31" }[fiscal_period]}`, fiscal_year, fiscal_period },
    precision: null,
    publication: [{ attestation_id: "p", timing: { available_not_before: null, available_no_later_than: publicBy, timing_precision: "instant", source_timezone: "UTC" } }],
  }) as unknown as InputCandidate;
  const requests: CandidateRequest[] = [];
  const overview = async (page: CandidatePage) => {
    const evidence = { listInputCandidates: async (request: CandidateRequest) => (requests.push(request), page) } as FinancialEvidencePort;
    const planned = await planCompanyOverview(planningContext("NVDA"), evidence);
    if (planned === null) return null;
    assert.equal(planned.outcome, "ready", JSON.stringify(planned));
    const { plan, model_calls } = planned as Extract<PlanningResult, { outcome: "ready" }>;
    return { planner: plan.planner.kind, model_calls, units: plan.publication_units.map((unit) => unit.unit_id), outputs: outputLabels(plan) };
  };
  const reported = (...candidates: InputCandidate[]) => ({ status: "ok" as const, candidates, truncated: false });

  assert.deepEqual(await overview(reported(revenue(2025, "Q3"), revenue(2025, "Q4"), revenue(2025, "FY"), revenue(2026, "Q1", "2026-09-02T00:00:00.000Z"))), {
    planner: "deterministic",
    model_calls: 0,
    units: ["answer"],
    outputs: [
      "NVDA revenue Q1 2024",
      "NVDA revenue Q2 2024",
      "NVDA revenue Q3 2024",
      "NVDA revenue Q4 2024",
      "NVDA revenue Q1 2025",
      "NVDA revenue Q2 2025",
      "NVDA revenue Q3 2025",
      "NVDA revenue Q4 2025",
      "NVDA gross_profit Q4 2025",
      "NVDA operating_income Q4 2025",
      "NVDA net_income Q4 2025",
      "gross_margin(NVDA gross_profit Q4 2025, NVDA revenue Q4 2025)",
      "operating_margin(NVDA operating_income Q4 2025, NVDA revenue Q4 2025)",
      "net_margin(NVDA net_income Q4 2025, NVDA revenue Q4 2025)",
      "percent_change_positive_base(NVDA revenue Q4 2025, NVDA revenue Q3 2025)",
      "percent_change_positive_base(NVDA revenue Q4 2025, NVDA revenue Q4 2024)",
    ],
  }, "a fourth quarter with no precision proof is the newest; a quarter public after the cutoff, or a year, is not");
  assert.deepEqual(requests.map(({ subject, metric_key, fiscal_year, fiscal_period }) => ({ subject, metric_key, fiscal_year, fiscal_period })), [
    { subject: { kind: "issuer", id: GOLDEN_COMPANIES.find((company) => company.ticker === "NVDA")!.issuer_id }, metric_key: "revenue", fiscal_year: null, fiscal_period: null },
  ]);
  const afterQ1 = (await overview(reported(revenue(2025, "Q4"), revenue(2026, "Q1"))))!.outputs;
  assert.deepEqual([afterQ1[0], ...afterQ1.slice(-2)], [
    "NVDA revenue Q2 2024",
    "percent_change_positive_base(NVDA revenue Q1 2026, NVDA revenue Q4 2025)",
    "percent_change_positive_base(NVDA revenue Q1 2026, NVDA revenue Q1 2025)",
  ], "a first quarter compares with the fourth before it and with the first a year earlier");
  assert.equal(await overview(reported(revenue(2025, "FY"))), null, "no quarter reported: no overview");
  await assert.rejects(overview({ status: "error", reason_code: "database_error" }), /database_error/u);
});

test("a comparison shows each company's latest quarter, named from the newest it reported revenue for, never aligned by calendar (#398)", async () => {
  const revenue = (fiscal_year: number, fiscal_period: string, end: string, publicBy = "2026-08-01T00:00:00.000Z") => ({
    metric_key: "revenue",
    period: { start: null, end, fiscal_year, fiscal_period },
    precision: null,
    publication: [{ attestation_id: "p", timing: { available_not_before: null, available_no_later_than: publicBy, timing_precision: "instant", source_timezone: "UTC" } }],
  }) as unknown as InputCandidate;
  const reported = (...candidates: InputCandidate[]): CandidatePage => ({ status: "ok", candidates, truncated: false });
  // Each company's own fiscal calendar, as the golden dataset files them.
  const PAGES: Record<string, CandidatePage> = {
    NVDA: reported(revenue(2026, "Q3", "2025-10-26"), revenue(2026, "Q4", "2026-01-25"), revenue(2027, "Q1", "2026-04-26", "2026-09-02T00:00:00.000Z")),
    AMD: reported(revenue(2026, "Q1", "2026-03-28"), revenue(2026, "Q2", "2026-06-27")),
    AAPL: reported(revenue(2026, "Q2", "2026-03-28"), revenue(2026, "Q3", "2026-06-27")),
  };
  const tickerOf = (issuerId: string) => GOLDEN_COMPANIES.find((company) => company.issuer_id === issuerId)!.ticker;
  const compare = async (question: string, pages: Record<string, CandidatePage> = PAGES) => {
    const requests: CandidateRequest[] = [];
    const evidence = { listInputCandidates: async (request: CandidateRequest) => (requests.push(request), pages[tickerOf(request.subject.id)]!) } as FinancialEvidencePort;
    const planned = await planCompanyOverview(planningContext(question), evidence);
    const reads = requests.map(({ subject, metric_key, fiscal_year, fiscal_period }) => [tickerOf(subject.id), subject.kind, metric_key, fiscal_year, fiscal_period]);
    if (planned === null) return { planned, reads };
    assert.equal(planned.outcome, "ready", JSON.stringify(planned));
    const { plan, model_calls } = planned as Extract<PlanningResult, { outcome: "ready" }>;
    return {
      planner: plan.planner.kind,
      model_calls,
      units: plan.publication_units.map((unit) => unit.unit_id),
      output_ids: plan.outputs.map((output) => output.output_id),
      outputs: outputLabels(plan),
      reads,
    };
  };
  const latestQuarter = (ticker: string, quarter: string, previous: string, yearBefore: string) => [
    `${ticker} revenue ${quarter}`,
    `${ticker} gross_profit ${quarter}`,
    `${ticker} operating_income ${quarter}`,
    `${ticker} net_income ${quarter}`,
    `gross_margin(${ticker} gross_profit ${quarter}, ${ticker} revenue ${quarter})`,
    `operating_margin(${ticker} operating_income ${quarter}, ${ticker} revenue ${quarter})`,
    `net_margin(${ticker} net_income ${quarter}, ${ticker} revenue ${quarter})`,
    `percent_change_positive_base(${ticker} revenue ${quarter}, ${ticker} revenue ${previous})`,
    `percent_change_positive_base(${ticker} revenue ${quarter}, ${ticker} revenue ${yearBefore})`,
  ];
  const NVDA = latestQuarter("NVDA", "Q4 2026", "Q3 2026", "Q4 2025");
  const AMD = latestQuarter("AMD", "Q2 2026", "Q1 2026", "Q2 2025");
  const AAPL = latestQuarter("AAPL", "Q3 2026", "Q2 2026", "Q3 2025");
  const read = (ticker: string) => [ticker, "issuer", "revenue", null, null];
  const ids = (slot: string, quarter: string) =>
    [`revenue_${quarter}`, `gross_profit_${quarter}`, `operating_income_${quarter}`, `net_income_${quarter}`, "gross_margin", "operating_margin", "net_margin", "revenue_growth_qoq", "revenue_growth_yoy"]
      .map((id) => `out_${slot}_${id}`);

  assert.deepEqual(await compare("NVDA and AMD"), {
    planner: "deterministic",
    model_calls: 0,
    units: ["answer"],
    output_ids: [...ids("a", "fy2026_q4"), ...ids("b", "fy2026_q2")],
    outputs: [...NVDA, ...AMD],
    reads: [read("NVDA"), read("AMD")],
  }, "a quarter public after the cutoff is not NVDA's newest");
  const three = await compare("NVDA, AMD and AAPL");
  assert.deepEqual([three?.outputs, three?.reads], [[...NVDA, ...AMD, ...AAPL], [read("NVDA"), read("AMD"), read("AAPL")]]);

  assert.deepEqual((await compare("NVDA and AMD", { ...PAGES, AMD: reported(revenue(2025, "FY", "2025-12-27")) })).planned, null, "a company that reported no quarter");
  assert.deepEqual((await compare("NVDA and AMD", { ...PAGES, AMD: { ...PAGES.AMD!, truncated: true } as CandidatePage })).planned, null, "a truncated page");
  await assert.rejects(compare("NVDA and AMD", { ...PAGES, AMD: { status: "error", reason_code: "database_error" } }), /database_error/u);
});

const reading = (asks: string[], metrics: unknown[] = [], income_items: string[] = [], turnsOff: string[] = []) =>
  parseProposal(JSON.stringify({ metrics, asks, turns_off: { facets: turnsOff, metrics: [] }, income_items }))!;

test("a question about the companies it names that asks for no figure is answered with their overview, or one company's with its peers; one about a carried company, a figure or a period is not (#398)", async () => {
  const client = await createReplayLlmChatClient(REPLIES);
  const read = async (question: string) => parseProposal((await client({} as never, { messages: [{ role: "user", content: proposalQuestion(question) }] })).text);
  const AMD = GOLDEN_COMPANIES.find((company) => company.ticker === "AMD")!;
  const amd = async (): Promise<RequestedSubject[]> => [{ mention: AMD.issuer_id, resolution: { status: "resolved", subject_ref: { kind: "issuer", id: AMD.issuer_id }, label: AMD.legal_name } }];
  const none = async () => [];
  // The mentions of the companies the overview covers; null when the question is no overview.
  const overview = async (question: string, { carried = false, read: readQuestion = read, peersOf = none as typeof amd } = {}) => {
    const subjects = planningContext(question).requested_subjects;
    if (!namesCompanies(subjects, carried, question)) return null;
    return (await overviewSubjects(subjects, await readQuestion(question), peersOf))?.map((subject) => subject.mention) ?? null;
  };
  for (const ticker of ["NVDA", "AMD", "AAPL"]) assert.deepEqual(await overview(`Analyze ${ticker}`), [ticker], ticker);
  for (const question of ["Compare NVDA with AMD", "Compare NVDA and AMD again"]) assert.deepEqual(await overview(question), ["NVDA", "AMD"], question);
  const peers = "How does NVDA compare with its peers?";
  assert.deepEqual(await overview(peers, { peersOf: amd }), ["NVDA", AMD.issuer_id], "NVDA, then its peers");
  assert.equal(await overview(peers), null, "no peer resolves");
  const scripted = (proposal: ReturnType<typeof reading>) => ({ read: async () => proposal });
  assert.equal(await overview("Compare NVDA and AMD with their peers", { ...scripted(reading(["peers"])), peersOf: amd }), null, "peers of two named companies");
  assert.deepEqual(await overview("Analyze NVDA and AMD", scripted(reading([]))), ["NVDA", "AMD"], "two companies");
  assert.equal(await overview("Analyze NVDA", scripted(reading([], ["income_statement"]))), null, "a metric");
  assert.equal(await overview("Compare NVDA with AMD", scripted(reading([], ["income_statement"]))), null, "a metric in a comparison");
  assert.equal(await overview("Analyze NVDA, no margins", scripted(reading([], [], [], ["margins"]))), null, "a facet turned off");
  assert.equal(await overview("Compare NVDA with AMD", scripted(reading([], [], [], ["margins"]))), null, "a facet turned off in a comparison");
  assert.equal(await overview("Analyze NVDA", scripted({ ...reading([]), turns_off: { facets: new Set(), metrics: new Set(["revenue"]) } })), null, "a metric turned off");
  assert.equal(await overview("Analyze NVDA", { carried: true }), null, "a carried company");
  assert.equal(await overview("Compare NVDA with AMD", { carried: true }), null, "a carried company beside named ones");
  for (const period of ["in fiscal 2025", "for Q4 2025", "YTD", "for Q3", "in the third quarter"]) {
    assert.equal(await overview(`Analyze NVDA ${period}`, scripted(reading([]))), null, period);
  }
  for (const period of ["in fiscal 2025", "for Q4 2025", "YTD", "for Q3"]) {
    assert.equal(await overview(`Compare NVDA and AMD ${period}`, scripted(reading([]))), null, `a comparison ${period}`);
  }
  const yearToDate = "Compare it with AMD YTD";
  assert.deepEqual(
    [namesCompanies(planningContext(yearToDate).requested_subjects, true, yearToDate), await overviewSubjects(planningContext(yearToDate).requested_subjects, await read(yearToDate), none)],
    [false, null],
    "the golden conversation's comparison carries NVDA, and its reading asks for a price window",
  );
});

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

  // A qualified metric is checked on each company's own figures too.
  const fy = (fiscal_year: number) => ({ kind: "fiscal_period", fiscal_year, fiscal_period: "FY" });
  const eps = (node_id: string, subject_slot: string, fiscal_year: number) => ({ node_id, operation: "reported_metric", subject_slot, metric_key: "eps_diluted", period: fy(fiscal_year) });
  const change = (slot: string) => ({ node_id: `${slot}_g`, operation: "percent_change_positive_base", current: `${slot}_e26`, prior: `${slot}_e25` });
  const epsPlan = (operations: object[], shown: string[]) => {
    const drafted = buildDeterministicPlan(planningContext("NVDA and AMD"), {
      subjects: [{ slot_id: "a", mention: "NVDA" }, { slot_id: "b", mention: "AMD" }],
      operations,
      outputs: shown.map((node_id) => ({ output_id: `out_${node_id}`, node_id })),
      thresholds: [],
    });
    assert.equal(drafted.outcome, "ready", JSON.stringify(drafted));
    return (drafted as Extract<PlanningResult, { outcome: "ready" }>).plan;
  };
  const years = (slot: string) => [eps(`${slot}_e25`, slot, 2025), eps(`${slot}_e26`, slot, 2026)];
  const growthForNvda = epsPlan([...years("a"), change("a"), eps("b_e26", "b", 2026)], ["a_g", "b_e26"]);
  const growthForBoth = epsPlan([...years("a"), change("a"), ...years("b"), change("b")], ["a_g", "b_g"]);
  const trendForNvda = epsPlan([...years("a"), eps("b_e26", "b", 2026)], ["a_e25", "a_e26", "b_e26"]);
  const asked = (qualifier: string) => reading([], [{ metric: "eps_diluted", qualifier }]);
  assert.deepEqual(uncoveredAsks(asked("growth"), growthForNvda, labels), ["earnings per share growth for AMD"]);
  assert.deepEqual(uncoveredAsks(asked("growth"), growthForBoth, labels), []);
  assert.deepEqual(uncoveredAsks(asked("trend"), trendForNvda, labels), ["earnings per share trend for AMD"]);
});

test("an engine answer that covers peers does not name them as left out (#398)", () => {
  const q4 = { kind: "fiscal_period", fiscal_year: 2026, fiscal_period: "Q4" };
  const planned = buildDeterministicPlan(planningContext("NVDA and AMD"), {
    subjects: [{ slot_id: "a", mention: "NVDA" }, { slot_id: "b", mention: "AMD" }],
    operations: ["a", "b"].map((slot) => ({ node_id: `${slot}_rev`, operation: "reported_metric", subject_slot: slot, metric_key: "revenue", period: q4 })),
    outputs: ["a_rev", "b_rev"].map((node_id) => ({ output_id: `out_${node_id}`, node_id })),
    thresholds: [],
  });
  assert.equal(planned.outcome, "ready", JSON.stringify(planned));
  const plan = (planned as Extract<PlanningResult, { outcome: "ready" }>).plan;
  const labels = new Map([[GOLDEN_COMPANIES.find((company) => company.ticker === "NVDA")!.issuer_id, "NVDA"]]);

  assert.deepEqual(uncoveredAsks(reading(["peers"]), plan, labels, true), [], "the plan answered peers");
  assert.deepEqual(uncoveredAsks(reading(["peers"]), plan, labels), ["peers the question did not name"]);
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
  const basic = { node_id: "b25", operation: "reported_metric", subject_slot: "a", metric_key: "eps_basic", period: year(2025) };
  const mixed = plan([basic, eps("e26", 2026), { node_id: "g", operation: "percent_change_positive_base", current: "e26", prior: "b25" }], ["g"]);
  assert.deepEqual(uncoveredAsks(asked({ metric: "eps_diluted", qualifier: "growth" }), mixed), ["earnings per share growth"], "a change from another figure is not its growth");
  const balance = (node_id: string, metric_key: string, fiscal_year: number) => ({ node_id, operation: "reported_metric", subject_slot: "a", metric_key, period: year(fiscal_year) });
  const leverage = (suffix: string, fiscal_year: number) => [
    balance(`tl${suffix}`, "total_liabilities", fiscal_year),
    balance(`ta${suffix}`, "total_assets", fiscal_year),
    { node_id: `r${suffix}`, operation: "ratio", ratio_key: "liabilities_to_assets", numerator: `tl${suffix}`, denominator: `ta${suffix}` },
  ];
  const ratioChange = plan([...leverage("25", 2025), ...leverage("26", 2026), { node_id: "g", operation: "percent_change_positive_base", current: "r26", prior: "r25" }], ["g"]);
  assert.deepEqual(uncoveredAsks(asked({ metric: "total_assets", qualifier: "growth" }), ratioChange), ["total assets growth"], "a change of a ratio over total assets is not total assets growth");
});
