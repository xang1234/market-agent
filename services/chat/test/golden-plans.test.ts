import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { createRuntimeAuthority, operationDependencies, type FinancialPlanV1 } from "../../financial-core/src/index.ts";
import { buildDeterministicPlan, planFinancialRequest, type PlanningContext, type PlanningModel, type PlanningResult, type RequestedSubject } from "../../financial-engine/src/planner.ts";
import type { CandidatePage, CandidateRequest, FinancialEvidencePort, InputCandidate, SqlExecutor } from "../../financial-engine/src/ports.ts";
import { createReplayLlmChatClient } from "../../llm/src/replay-client.ts";
import {
  allResolved,
  keptFigures,
  LATEST,
  marginTrendSubjects,
  overviewOmissions,
  overviewPeers,
  overviewSubjects,
  planCompanyOverview,
  planMarginTrend,
  planScopeFigures,
  readPeriod,
  type ReadPeriod,
} from "../src/company-overview.ts";
import { MAX_TURN_SUBJECTS } from "../src/coordinator.ts";
import { uncoveredAsks } from "../src/financial-runtime.ts";
import { resolveResearchScope } from "../src/research-scope.ts";
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

test("each recorded reply matched by one substring answers a request made of that substring, so no reply shadows it", async () => {
  const replies = (JSON.parse(readFileSync(REPLIES, "utf8")) as { replies: Array<{ match: string | string[]; text: string }> }).replies;
  const client = await createReplayLlmChatClient(REPLIES);
  for (const reply of replies) {
    if (typeof reply.match !== "string") continue;
    assert.equal((await client({} as never, { messages: [{ role: "user", content: reply.match }] })).text, reply.text, reply.match);
  }
});

test("each golden metric question plans from its own recorded reply on the first call", async () => {
  // Each recorded planner reply answers one golden question, and each is expected here.
  const questions = (JSON.parse(readFileSync(REPLIES, "utf8")) as { replies: Array<{ match: string | string[] }> }).replies
    .flatMap((reply) => typeof reply.match === "string" ? /^Request: (.*)\nRequested$/u.exec(reply.match)?.[1] ?? [] : []);
  assert.deepEqual(questions, Object.keys(EXPECTED), "the golden questions the planner answers");

  const client = await createReplayLlmChatClient(REPLIES);
  const model: PlanningModel = async ({ messages }) => ({ text: (await client({} as never, { messages })).text, model: "recorded" });
  for (const question of questions) {
    assert.deepEqual(summary(await planFinancialRequest(planningContext(question), question, model)), EXPECTED[question], question);
  }
});

const revenueCandidate = (fiscal_year: number, fiscal_period: string, start: string | null, end: string, publicBy = "2026-03-01T00:00:00.000Z") => ({
  metric_key: "revenue",
  source_class: "sec_filing",
  unit: { kind: "currency", currency: "USD" },
  context: null,
  period: { start, end, fiscal_year, fiscal_period },
  precision: null,
  publication: [{ attestation_id: "p", timing: { available_not_before: null, available_no_later_than: publicBy, timing_precision: "instant", source_timezone: "UTC" } }],
}) as unknown as InputCandidate;
const CALENDAR = { Q1: ["01-01", "03-31"], Q2: ["04-01", "06-30"], Q3: ["07-01", "09-30"], Q4: ["10-01", "12-31"], FY: ["01-01", "12-31"] } as const;
const calendarQuarter = (fiscal_year: number, fiscal_period: keyof typeof CALENDAR, publicBy?: string) =>
  revenueCandidate(fiscal_year, fiscal_period, `${fiscal_year}-${CALENDAR[fiscal_period][0]}`, `${fiscal_year}-${CALENDAR[fiscal_period][1]}`, publicBy);
const goldenQuarters = (ticker: string, publicBy?: string) => GOLDEN_COMPANIES.find((company) => company.ticker === ticker)!.quarters
  .map((quarter) => revenueCandidate(quarter.fiscal_year, quarter.fiscal_period, quarter.period_start, quarter.period_end, publicBy));
const candidatePage = (...candidates: InputCandidate[]): CandidatePage => ({ status: "ok", candidates, truncated: false });
const changeOf = (ticker: string, current: string, prior: string) => `percent_change_positive_base(${ticker} revenue ${current}, ${ticker} revenue ${prior})`;

const omissions = (plan: FinancialPlanV1, evidence: FinancialEvidencePort) => overviewOmissions(plan, authority, evidence, (slot) => {
  const member = plan.subjects.members.find((candidate) => candidate.slot_id === slot)!;
  return GOLDEN_COMPANIES.find((company) => company.issuer_id === member.subject_ref.id)!.legal_name;
});

async function overviewOf(question: string, pages: (ticker: string) => CandidatePage, plan = planCompanyOverview) {
  const tickerOf = (issuerId: string) => GOLDEN_COMPANIES.find((company) => company.issuer_id === issuerId)!.ticker;
  const evidence = { listInputCandidates: async (request: CandidateRequest) => pages(tickerOf(request.subject.id)) } as FinancialEvidencePort;
  const planned = await plan(planningContext(question), evidence);
  if (planned === null) return null;
  assert.equal(planned.outcome, "ready", JSON.stringify(planned));
  return { outputs: outputLabels(planned.plan), uncovered: await omissions(planned.plan, evidence) };
}

test("a company's overview shows its eight quarters to the newest it reported revenue for by the cutoff, each named by its fiscal period (#398)", async (t) => {
  const warned: unknown[][] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => warned.push(args));
  const requests: CandidateRequest[] = [];
  const overview = async (page: CandidatePage) => {
    const evidence = { listInputCandidates: async (request: CandidateRequest) => (requests.push(request), page) } as FinancialEvidencePort;
    const planned = await planCompanyOverview(planningContext("NVDA"), evidence);
    if (planned === null) return null;
    assert.equal(planned.outcome, "ready", JSON.stringify(planned));
    const { plan, model_calls } = planned;
    const uncovered = await omissions(plan, { listInputCandidates: async () => page } as unknown as FinancialEvidencePort);
    return { planner: plan.planner.kind, model_calls, units: plan.publication_units.map((unit) => unit.unit_id), outputs: outputLabels(plan), uncovered };
  };
  const charted = [2024, 2025].flatMap((year) => (["Q1", "Q2", "Q3", "Q4"] as const).map((quarter) => `${quarter} ${year}`));
  const eightQuarters = [2024, 2025].flatMap((year) => (["Q1", "Q2", "Q3", "Q4"] as const).map((quarter) => calendarQuarter(year, quarter)));

  assert.deepEqual(await overview(candidatePage(...eightQuarters, calendarQuarter(2025, "FY"), calendarQuarter(2026, "Q1", "2026-09-02T00:00:00.000Z"))), {
    planner: "deterministic",
    model_calls: 0,
    units: ["answer"],
    outputs: [
      ...charted.map((quarter) => `NVDA revenue ${quarter}`),
      "NVDA gross_profit Q4 2025",
      "NVDA operating_income Q4 2025",
      "NVDA net_income Q4 2025",
      "gross_margin(NVDA gross_profit Q4 2025, NVDA revenue Q4 2025)",
      "operating_margin(NVDA operating_income Q4 2025, NVDA revenue Q4 2025)",
      "net_margin(NVDA net_income Q4 2025, NVDA revenue Q4 2025)",
      ...charted.slice(1).map((quarter, index) => changeOf("NVDA", quarter, charted[index]!)),
      changeOf("NVDA", "Q4 2025", "Q4 2024"),
      ...["highest", "lowest"].map(() => `period_rank(${charted.map((quarter) => `NVDA revenue ${quarter}`).join(", ")})`),
    ],
    uncovered: [],
  }, "a fourth quarter with no precision proof is the newest; a quarter public after the cutoff, or a year, is not");
  assert.deepEqual(requests.map(({ subject, metric_key, fiscal_year, fiscal_period }) => ({ subject, metric_key, fiscal_year, fiscal_period })), [
    { subject: { kind: "issuer", id: GOLDEN_COMPANIES.find((company) => company.ticker === "NVDA")!.issuer_id }, metric_key: "revenue", fiscal_year: null, fiscal_period: null },
  ]);
  const afterQ1 = (await overview(candidatePage(...eightQuarters.slice(4), calendarQuarter(2026, "Q1"))))!.outputs;
  assert.deepEqual([afterQ1[0], ...afterQ1.filter((output) => output.startsWith("percent_change")).slice(-2)], [
    "NVDA revenue Q2 2024",
    changeOf("NVDA", "Q1 2026", "Q4 2025"),
    changeOf("NVDA", "Q1 2026", "Q1 2025"),
  ], "a first quarter compares with the fourth before it and with the first a year earlier");
  const segment = { period_type: "duration", dimension_scope: "segment", dimension_members: [{ axis: "srt:ProductOrServiceAxis", member: "nvda:DataCenterMember" }], adjustment_basis: "unadjusted", share_basis: "not_applicable", fiscal_calendar_version: "fiscal-calendar.v1", disclosure_relation: "original" };
  const notReported = await overview(candidatePage(calendarQuarter(2025, "Q4"), { ...calendarQuarter(2026, "Q1"), context: segment } as unknown as InputCandidate, { ...calendarQuarter(2026, "Q2"), source_class: "issuer_disclosure" }));
  assert.equal(notReported!.outputs[0], "NVDA revenue Q1 2024", "a segment's value or a disallowed source's does not name the newest quarter, as it cannot for the engine");
  assert.equal(await overview(candidatePage(calendarQuarter(2025, "FY"))), null, "no quarter reported: no overview");
  assert.equal(await overview({ status: "error", reason_code: "database_error" }), null, "a failed read: no overview");
  assert.deepEqual(warned, [["[chat] the company overview could not be planned; the planner answers", "database_error"]]);
});

test("a change is planned only between quarters whose reported dates follow each other, and one that is not is named (#479)", async () => {
  const run = (start: string, labels: ReadonlyArray<[number, string]>, days: ReadonlyArray<number>) => {
    let next = Date.parse(`${start}T00:00:00Z`);
    return labels.map(([year, quarter], index) => {
      const from = new Date(next).toISOString().slice(0, 10);
      next += days[index]! * 86_400_000;
      return revenueCandidate(year, quarter, from, new Date(next - 86_400_000).toISOString().slice(0, 10));
    });
  };
  const eight = [2023, 2024].flatMap((year) => ["Q1", "Q2", "Q3", "Q4"].map((quarter): [number, string] => [year, quarter]));
  const changes = (outputs: ReadonlyArray<string>) => outputs.filter((output) => output.startsWith("percent_change"));
  const all = [...eight.slice(1).map(([year, quarter], index) => changeOf("NVDA", `${quarter} ${year}`, `${eight[index]![1]} ${eight[index]![0]}`)), changeOf("NVDA", "Q4 2024", "Q4 2023")];

  const longYear = await overviewOf("NVDA", () => candidatePage(...run("2023-01-02", eight, [91, 91, 91, 98, 91, 91, 91, 91])));
  assert.deepEqual([changes(longYear!.outputs), longYear!.uncovered], [all, []], "a 53-week year's 14-week fourth quarter still follows its third");

  const moved = [...run("2023-01-01", eight.slice(0, 4), [90, 91, 92, 92]), ...run("2024-02-01", eight.slice(4), [90, 92, 92, 92])];
  const recalendared = await overviewOf("NVDA", () => candidatePage(...moved));
  assert.deepEqual(changes(recalendared!.outputs), all.filter((change) => !change.includes("Q1 2024, NVDA revenue Q4 2023") && !change.includes("Q4 2024, NVDA revenue Q4 2023")));
  assert.deepEqual(recalendared!.uncovered, [
    "revenue growth from Q4 FY2023 to Q1 FY2024, whose quarters are not dated consecutively",
    "revenue growth from Q4 FY2023 to Q4 FY2024, whose quarters are not dated consecutively",
  ], "a new fiscal year end leaves a transition month between the old calendar's last quarter and the new one's first");

  const mislabelled = [...goldenQuarters("NVDA").slice(0, 4), revenueCandidate(2026, "Q1", "2025-07-28", "2025-10-26")];
  const misread = await overviewOf("NVDA", () => candidatePage(...mislabelled));
  assert.deepEqual([changes(misread!.outputs).filter((change) => change.includes("Q1 2026")), misread!.uncovered.filter((note) => note.includes("Q1 FY2026"))], [[], [
    "revenue growth from Q4 FY2025 to Q1 FY2026, whose quarters are not dated consecutively",
    "revenue growth from Q1 FY2025 to Q1 FY2026, whose quarters are not dated consecutively",
  ]], "the quarter filed as Q1 FY2026 is dated as the third after Q4 FY2025: neither the latest QoQ nor its YoY");
  const startingOn = async (start: string) => changes((await overviewOf("NVDA", () => candidatePage(...goldenQuarters("NVDA").slice(0, 7), revenueCandidate(2026, "Q4", start, "2026-01-25"))))!.outputs)
    .filter((change) => change.includes("Q4 2026, NVDA revenue Q3 2026"));
  assert.deepEqual([await startingOn("2025-11-02"), await startingOn("2025-11-03")], [[changeOf("NVDA", "Q4 2026", "Q3 2026")], []],
    "Q3 FY2026 ends 2025-10-26: a quarter starting up to a week later still follows it, eight days later it does not");
  const disputed = await overviewOf("NVDA", () => candidatePage(...goldenQuarters("NVDA"), revenueCandidate(2026, "Q3", "2025-07-28", "2025-10-19")));
  assert.deepEqual([changes(disputed!.outputs).filter((change) => change.includes("Q3 2026")), disputed!.uncovered], [[], [
    "revenue growth from Q2 FY2026 to Q3 FY2026, as its filings date Q3 FY2026 differently",
    "revenue growth from Q3 FY2026 to Q4 FY2026, as its filings date Q3 FY2026 differently",
    "revenue growth from Q4 FY2025 to Q4 FY2026, as its filings date Q3 FY2026 differently",
  ]], "two filings that date one quarter differently prove neither date");

  const five = await overviewOf("NVDA", () => candidatePage(...goldenQuarters("NVDA").slice(3)));
  const shown = GOLDEN_COMPANIES.find((company) => company.ticker === "NVDA")!.quarters.map((quarter) => `${quarter.fiscal_period} ${quarter.fiscal_year}`);
  assert.deepEqual([changes(five!.outputs), five!.uncovered], [[...shown.slice(1).map((quarter, index) => changeOf("NVDA", quarter, shown[index]!)), changeOf("NVDA", "Q4 2026", "Q4 2025")], []],
    "five quarters reported: a change from one of the three before them is a gap where it falls, never a note");
  const gapped = await overviewOf("NVDA", () => candidatePage(...goldenQuarters("NVDA").filter((quarter) => quarter.period.fiscal_year !== 2026 || quarter.period.fiscal_period !== "Q2")));
  assert.deepEqual([changes(gapped!.outputs).filter((change) => change === changeOf("NVDA", "Q4 2026", "Q4 2025")), gapped!.uncovered], [[], ["revenue growth from Q4 FY2025 to Q4 FY2026, as Q2 FY2026 has no reported revenue"]],
    "a year whose middle quarter was never reported is not proven to follow on");

  const apart = await overviewOf("NVDA", () => candidatePage(...eight.flatMap(([year, quarter]) => run(`${year}-${CALENDAR[quarter as keyof typeof CALENDAR][0]}`, [[year, quarter]], [60]))));
  const named = ([fromYear, from]: [number, string], [toYear, to]: [number, string]) => `revenue growth from ${from} FY${fromYear} to ${to} FY${toYear}, whose quarters are not dated consecutively`;
  assert.deepEqual([changes(apart!.outputs), apart!.uncovered], [[], [...eight.slice(1).map((to, index) => named(eight[index]!, to)), named(eight[3]!, eight[7]!)]],
    "an overview that pairs no quarters plans no growth, and its note names every change");
});

test("a comparison shows each company's latest quarter, named from the newest it reported revenue for, never aligned by calendar, and the first company's lead in each margin (#398)", async (t) => {
  t.mock.method(console, "warn", () => {});
  const PAGES: Record<string, CandidatePage> = {
    NVDA: candidatePage(...goldenQuarters("NVDA", "2026-08-01T00:00:00.000Z"), revenueCandidate(2027, "Q1", "2026-01-26", "2026-04-26", "2026-09-02T00:00:00.000Z")),
    AMD: candidatePage(...goldenQuarters("AMD", "2026-08-01T00:00:00.000Z")),
    AAPL: candidatePage(...goldenQuarters("AAPL", "2026-08-01T00:00:00.000Z")),
  };
  const tickerOf = (issuerId: string) => GOLDEN_COMPANIES.find((company) => company.issuer_id === issuerId)!.ticker;
  const compare = async (question: string, pages: Record<string, CandidatePage> = PAGES) => {
    const requests: CandidateRequest[] = [];
    const evidence = { listInputCandidates: async (request: CandidateRequest) => (requests.push(request), pages[tickerOf(request.subject.id)]!) } as FinancialEvidencePort;
    const planned = await planCompanyOverview(planningContext(question), evidence);
    const reads = requests.map(({ subject, metric_key, fiscal_year, fiscal_period }) => [tickerOf(subject.id), subject.kind, metric_key, fiscal_year, fiscal_period]);
    if (planned === null) return { planned, reads };
    assert.equal(planned.outcome, "ready", JSON.stringify(planned));
    const { plan, model_calls } = planned;
    return {
      planner: plan.planner.kind,
      model_calls,
      units: plan.publication_units.map((unit) => unit.unit_id),
      output_ids: plan.outputs.map((output) => output.output_id),
      outputs: outputLabels(plan),
      uncovered: await omissions(plan, evidence),
      reads,
    };
  };
  const margin = (ticker: string, metric: string, line: string, quarter: string) => `${metric}(${ticker} ${line} ${quarter}, ${ticker} revenue ${quarter})`;
  const MARGINS = [["gross_margin", "gross_profit"], ["operating_margin", "operating_income"], ["net_margin", "net_income"]] as const;
  const latestQuarter = (ticker: string, quarter: string, previous: string, yearBefore: string) => [
    `${ticker} revenue ${quarter}`,
    ...MARGINS.map(([, line]) => `${ticker} ${line} ${quarter}`),
    ...MARGINS.map(([metric, line]) => margin(ticker, metric, line, quarter)),
    changeOf(ticker, quarter, previous),
    changeOf(ticker, quarter, yearBefore),
  ];
  const CLOSEST: Record<string, [string, string]> = { AMD: ["Q4 2025", "fy2025_q4"], AAPL: ["Q1 2026", "fy2026_q1"] };
  const leads = (...tickers: string[]) => MARGINS.flatMap(([metric, line]) => tickers.slice(1).map((other) =>
    `spread(${margin(tickers[0]!, metric, line, "Q4 2026")}, ${margin(other, metric, line, CLOSEST[other]![0])})`));
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
    output_ids: [
      ...ids("a", "fy2026_q4"),
      ...ids("b", "fy2026_q2"),
      ...MARGINS.map(([metric]) => `out_a_minus_b_${metric}`),
    ],
    outputs: [...NVDA, ...AMD, ...leads("NVDA", "AMD")],
    uncovered: [],
    reads: [read("NVDA"), read("AMD")],
  }, "a quarter public after the cutoff is not NVDA's newest");
  const three = await compare("NVDA, AMD and AAPL");
  assert.deepEqual([three?.outputs, three?.reads], [[...NVDA, ...AMD, ...AAPL, ...leads("NVDA", "AMD", "AAPL")], [read("NVDA"), read("AMD"), read("AAPL")]],
    "NVDA's newest quarter ends 2026-01-25, and AMD's Q4 2025 and AAPL's Q1 2026 each 29 days before it");
  const noLead = "NVIDIA Corporation's lead over Advanced Micro Devices, Inc. in each margin, as no quarter Advanced Micro Devices, Inc. reported ends within half a quarter of NVIDIA Corporation's Q4 FY2026";
  const apart = await compare("NVDA and AMD", { ...PAGES, AMD: candidatePage(...goldenQuarters("AMD", "2026-08-01T00:00:00.000Z").slice(6)) });
  assert.deepEqual([apart.outputs?.filter((output) => output.startsWith("spread")), apart.uncovered], [[], [noLead]], "AMD's Q1 2026 ends 62 days after NVDA's newest: more than half a quarter");
  const disputed = await compare("NVDA and AMD", { ...PAGES, NVDA: candidatePage(...goldenQuarters("NVDA", "2026-08-01T00:00:00.000Z"), revenueCandidate(2026, "Q4", "2025-10-27", "2026-01-18", "2026-08-01T00:00:00.000Z")) });
  assert.deepEqual([disputed.outputs?.filter((output) => output.startsWith("spread")), disputed.uncovered?.at(-1)], [[],
    "NVIDIA Corporation's lead over Advanced Micro Devices, Inc. in each margin, as the filings of NVIDIA Corporation do not agree on the dates of its Q4 FY2026"]);
  const undated = await compare("NVDA and AMD", { ...PAGES, AMD: candidatePage(revenueCandidate(2026, "Q1", null, "2026-03-28"), revenueCandidate(2026, "Q2", null, "2026-06-27")) });
  assert.deepEqual(undated.uncovered, [
    "revenue growth from Q1 FY2026 to Q2 FY2026 for Advanced Micro Devices, Inc., whose quarters are not dated consecutively",
    noLead,
  ], "a company is named when several are compared; Q2 FY2025 was never reported, so its year-over-year change is a gap where it falls");

  let inFlight = 0;
  let most = 0;
  const oneAtATime = {
    listInputCandidates: async (request: CandidateRequest) => {
      most = Math.max(most, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return PAGES[tickerOf(request.subject.id)]!;
    },
  } as FinancialEvidencePort;
  assert.notEqual(await planCompanyOverview(planningContext("NVDA, AMD and AAPL"), oneAtATime), null);
  assert.equal(most, 1, "one read at a time on the request's one client");

  assert.deepEqual((await compare("NVDA and AMD", { ...PAGES, AMD: candidatePage(revenueCandidate(2025, "FY", "2024-12-29", "2025-12-27")) })).planned, null, "a company that reported no quarter");
  assert.deepEqual((await compare("NVDA and AMD", { ...PAGES, AMD: { ...PAGES.AMD!, truncated: true } as CandidatePage })).planned, null, "a truncated page");
  assert.deepEqual((await compare("NVDA and AMD", { ...PAGES, AMD: { status: "error", reason_code: "database_error" } })).planned, null, "a failed read");
});

const reading = (asks: string[], metrics: unknown[] = [], income_items: string[] = [], turnsOff: string[] = [], period: unknown = { kind: "none" }) =>
  parseProposal(JSON.stringify({ metrics, asks, turns_off: { facets: turnsOff, metrics: [] }, income_items, period, companies: { kind: "as_named", names: [] } }), "")!;

test("an overview at a period shows each company from its own quarter there: the one named, a quarter named alone at its newest, a fiscal year at its newest quarter (#398)", async () => {
  const at = async (period: ReadPeriod, candidates = goldenQuarters("NVDA")) => {
    const shown = await overviewOf("NVDA", () => candidatePage(...candidates), (context, evidence) => planCompanyOverview(context, evidence, period));
    return shown && [shown.outputs[0], shown.outputs.find((output) => output.startsWith("gross_margin")), shown.outputs.filter((output) => output.startsWith("percent_change")).at(-1)];
  };
  const quarter = (fiscal_period: string, fiscal_year: number | null = null): ReadPeriod => ({ kind: "fiscal_quarter", fiscal_period, fiscal_year });
  const margin = (quarter: string) => `gross_margin(NVDA gross_profit ${quarter}, NVDA revenue ${quarter})`;
  assert.deepEqual(await at(LATEST), ["NVDA revenue Q1 2025", margin("Q4 2026"), changeOf("NVDA", "Q4 2026", "Q4 2025")]);
  assert.deepEqual(await at(quarter("Q2")), ["NVDA revenue Q3 2024", margin("Q2 2026"), changeOf("NVDA", "Q2 2026", "Q2 2025")], "its newest second quarter");
  assert.deepEqual(await at(quarter("Q2", 2025)), ["NVDA revenue Q3 2023", margin("Q2 2025"), changeOf("NVDA", "Q2 2025", "Q2 2024")]);
  assert.deepEqual(await at({ kind: "fiscal_year", fiscal_year: 2025 }), ["NVDA revenue Q1 2024", margin("Q4 2025"), changeOf("NVDA", "Q4 2025", "Q4 2024")], "the year's newest quarter");
  assert.deepEqual(await at({ kind: "fiscal_year", fiscal_year: 2019 }), ["NVDA revenue Q1 2018", margin("Q4 2019"), changeOf("NVDA", "Q4 2019", "Q4 2018")], "a year never reported: its fourth quarter, each figure a gap");
  assert.equal(await at(quarter("Q2"), goldenQuarters("NVDA").filter((candidate) => candidate.period.fiscal_period !== "Q2")), null, "a quarter named alone it never reported");

  // Its note is read again at the quarter its saved margins are of.
  const undated = goldenQuarters("NVDA").map((candidate) => candidate.period.fiscal_year === 2026 && candidate.period.fiscal_period === "Q1"
    ? revenueCandidate(2026, "Q1", "2025-02-15", "2025-04-27")
    : candidate);
  const q1 = await overviewOf("NVDA", () => candidatePage(...undated), (context, evidence) => planCompanyOverview(context, evidence, quarter("Q1", 2026)));
  assert.deepEqual(q1!.uncovered, [
    "revenue growth from Q4 FY2025 to Q1 FY2026, whose quarters are not dated consecutively",
    "revenue growth from Q1 FY2025 to Q1 FY2026, whose quarters are not dated consecutively",
  ]);
});

test("a follow-up's kept figures are each chat metric's engine figures at the period it reads (#398)", async () => {
  const tickerOf = (issuerId: string) => GOLDEN_COMPANIES.find((company) => company.issuer_id === issuerId)!.ticker;
  const evidence = { listInputCandidates: async (request: CandidateRequest) => candidatePage(...goldenQuarters(tickerOf(request.subject.id))) } as FinancialEvidencePort;
  const figures = async (question: string, metrics: string[], period: ReadPeriod) => {
    const planned = await planScopeFigures(planningContext(question), evidence, metrics, period);
    return planned && outputLabels(planned.plan);
  };
  const cashFlow = (ticker: string, period: string) => [
    `${ticker} operating_cash_flow ${period}`,
    `${ticker} capex ${period}`,
    `free_cash_flow(${ticker} operating_cash_flow ${period}, ${ticker} capex ${period})`,
  ];
  const fcf = ["free_cash_flow", "operating_cash_flow", "capex"];
  assert.deepEqual(await figures("AMD", fcf, LATEST), cashFlow("AMD", "latest annual[0]"), "the latest fiscal year");
  assert.deepEqual(await figures("AMD", fcf, { kind: "fiscal_year", fiscal_year: 2025 }), cashFlow("AMD", "FY 2025"));
  assert.deepEqual(await figures("AMD", ["free_cash_flow"], { kind: "fiscal_quarter", fiscal_period: "Q2", fiscal_year: 2025 }), cashFlow("AMD", "Q2 2025"), "the engine says free cash flow is annual");
  assert.deepEqual(await figures("AMD", ["balance_sheet"], { kind: "fiscal_year", fiscal_year: 2025 }), ["cash_and_equivalents", "total_assets", "total_liabilities", "total_equity"].map((metric) => `AMD ${metric} FY 2025`));
  const income = (ticker: string, period: string) => [
    `${ticker} revenue ${period}`,
    `${ticker} gross_profit ${period}`,
    `${ticker} operating_income ${period}`,
    `${ticker} net_income ${period}`,
    `gross_margin(${ticker} gross_profit ${period}, ${ticker} revenue ${period})`,
    `operating_margin(${ticker} operating_income ${period}, ${ticker} revenue ${period})`,
    `net_margin(${ticker} net_income ${period}, ${ticker} revenue ${period})`,
  ];
  const q2 = { kind: "fiscal_quarter", fiscal_period: "Q2", fiscal_year: null } as const;
  assert.deepEqual(await figures("AMD", ["income_statement", "eps_diluted"], q2), [...income("AMD", "Q2 2026"), "AMD eps_diluted Q2 2026"], "a quarter named alone is the company's newest");
  assert.deepEqual(await figures("NVDA and AMD", ["eps_diluted"], q2), ["NVDA eps_diluted Q2 2026", "AMD eps_diluted Q2 2026"], "each company's own");
  assert.deepEqual(await figures("NVDA and AAPL", ["eps_diluted"], q2), ["NVDA eps_diluted Q2 2026", "AAPL eps_diluted Q2 2026"]);
  for (const metrics of [["market_cap"], ["eps_diluted", "pe_ratio"], ["ebitda"], []]) assert.equal(await figures("AMD", metrics, LATEST), null, JSON.stringify(metrics));
});

test("a reading's period: a follow-up keeps its scope's, a question of its own reads the latest, and one no fiscal field holds is the planner's (#398)", () => {
  const scope = (fiscal_year: number | null, fiscal_quarter: { fiscal_year: number; fiscal_period: string } | null = null) => ({ fiscal_year, fiscal_quarter });
  const own = { kind: "as_named", names: ["NVDA"] } as const;
  const period = (read: ReturnType<typeof reading>, scoped = scope(null)) => readPeriod(read, scoped);
  assert.deepEqual(period(reading([])), LATEST);
  assert.deepEqual(period(reading([]), scope(2025)), { kind: "fiscal_year", fiscal_year: 2025 });
  assert.deepEqual(period(reading([]), scope(2025, { fiscal_year: 2025, fiscal_period: "Q2" })), { kind: "fiscal_quarter", fiscal_year: 2025, fiscal_period: "Q2" });
  assert.deepEqual(period({ ...reading([]), companies: own }, scope(2025)), LATEST, "a question of its own");
  assert.deepEqual(period(reading([], [], [], [], { kind: "latest" }), scope(2025)), LATEST);
  const q2 = reading([], [], [], [], { kind: "fiscal_quarter", fiscal_period: "Q2", fiscal_year: null });
  assert.deepEqual(period(q2), { kind: "fiscal_quarter", fiscal_period: "Q2", fiscal_year: null });
  assert.deepEqual(period(q2, scope(2025, { fiscal_year: 2025, fiscal_period: "Q2" })), { kind: "fiscal_quarter", fiscal_period: "Q2", fiscal_year: 2025 }, "the year the scope gives it");
  assert.equal(period(reading([], [], [], [], { kind: "trailing_twelve_months" })), null);

  const kept = (read: ReturnType<typeof reading>, ...metrics: string[]) => keptFigures(read, { metrics: metrics.map((metric_key) => ({ metric_key, label: metric_key, available: true })) });
  assert.deepEqual(kept(q2, "free_cash_flow", "capex"), ["free_cash_flow", "capex"]);
  assert.deepEqual(kept(reading(["explains"]), "eps_diluted"), ["eps_diluted"]);
  assert.equal(kept(q2, "income_statement"), null, "the overview shows them");
  assert.equal(kept({ ...q2, companies: own }, "free_cash_flow"), null, "a question of its own");
  assert.equal(kept(reading(["margins"]), "free_cash_flow"), null, "a figure asked for");
  assert.deepEqual(kept({ ...reading([]), turns_off: { facets: new Set(), metrics: new Set(["capex"]) } }, "free_cash_flow"), ["free_cash_flow"], "its scope has turned the rest off");
});

test("a question about its companies, named or carried, that asks for no figure is answered with their overview, or one company's with its peers; one about a figure or a period is not (#398)", async () => {
  const client = await createReplayLlmChatClient(REPLIES);
  const read = async (question: string) => parseProposal((await client({} as never, { messages: [{ role: "user", content: proposalQuestion(question) }] })).text, question);
  const AMD = GOLDEN_COMPANIES.find((company) => company.ticker === "AMD")!;
  const amd = async (): Promise<RequestedSubject[]> => [{ mention: AMD.issuer_id, resolution: { status: "resolved", subject_ref: { kind: "issuer", id: AMD.issuer_id }, label: AMD.legal_name } }];
  const none = async () => [];
  const overview = async (question: string, { read: readQuestion = read, peersOf = none as typeof amd } = {}) => {
    const subjects = planningContext(question).requested_subjects;
    if (!allResolved(subjects)) return null;
    const proposal = await readQuestion(question);
    const scope = resolveResearchScope({ companies: [], prior: null, asOf: GOLDEN_AS_OF, proposal });
    return (await overviewSubjects(subjects, proposal, scope, peersOf))?.map((subject) => subject.mention) ?? null;
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
  assert.deepEqual(await overview("Explain the differences between NVDA and AMD", scripted(reading(["explains"]))), ["NVDA", "AMD"], "an explanation, which the commentary gives");
  assert.deepEqual(await overview("Analyze NVDA without peers", scripted(reading([], [], [], ["peers"]))), ["NVDA"], "a facet the overview does not show turned off");
  assert.equal(await overview("Analyze NVDA", scripted(reading(["explains", "margins"]))), null, "an explanation of a figure");
  assert.deepEqual(await overview("Analyze NVDA's most recent results", scripted(reading([], [], [], [], { kind: "latest" }))), ["NVDA"], "the latest period");
  const subjects = planningContext("Analyze NVDA").requested_subjects;
  assert.equal(await overviewSubjects(subjects, reading([]), null, none), null, "a scope that failed to resolve");
  // A fiscal period is the overview at it (planCompanyOverview); a price window, or a period no fiscal field holds, is not.
  const periods: Array<[string, ReturnType<typeof reading>, boolean]> = [
    ["in fiscal 2025", reading([], [], [], [], { kind: "fiscal_year", fiscal_year: 2025 }), true],
    ["for Q4 2025", reading([], [], [], [], { kind: "fiscal_quarter", fiscal_period: "Q4", fiscal_year: 2025 }), true],
    ["for Q3", reading([], [], [], [], { kind: "fiscal_quarter", fiscal_period: "Q3", fiscal_year: null }), true],
    ["YTD", reading(["price_window"]), false],
    ["over the last twelve months", reading([], [], [], [], { kind: "trailing_twelve_months" }), false],
    ["since 2021", reading([], [], [], [], { kind: "range" }), false],
  ];
  for (const [period, read, shown] of periods) {
    assert.deepEqual(await overview(`Analyze NVDA ${period}`, scripted(read)), shown ? ["NVDA"] : null, period);
    assert.deepEqual(await overview(`Compare NVDA and AMD ${period}`, scripted(read)), shown ? ["NVDA", "AMD"] : null, `a comparison ${period}`);
  }
  const yearToDate = "Compare it with AMD YTD";
  assert.deepEqual(
    [allResolved(planningContext(yearToDate).requested_subjects), await overviewSubjects(planningContext(yearToDate).requested_subjects, await read(yearToDate), null, none)],
    [true, null],
    "the golden conversation's comparison asks for a price window",
  );
});

test("a question about one company's margin trend plans its three margins over the charted quarters, each with its high and low, with no model (#398)", async () => {
  const quarters = GOLDEN_COMPANIES.find((company) => company.ticker === "NVDA")!.quarters.map((quarter) => `${quarter.fiscal_period} ${quarter.fiscal_year}`);
  const MARGINS = [["gross_margin", "gross_profit"], ["operating_margin", "operating_income"], ["net_margin", "net_income"]] as const;
  const over = (metric: string, line: string) => quarters.map((quarter) => `${metric}(NVDA ${line} ${quarter}, NVDA revenue ${quarter})`);
  assert.deepEqual(await overviewOf("NVDA", () => candidatePage(...goldenQuarters("NVDA")), planMarginTrend), {
    outputs: [
      ...MARGINS.flatMap(([metric, line]) => over(metric, line)),
      ...MARGINS.flatMap(([metric, line]) => ["highest", "lowest"].map(() => `period_rank(${over(metric, line).join(", ")})`)),
    ],
    uncovered: [],
  });

  const subjects = planningContext("NVDA").requested_subjects;
  const scope = { margin_trend: false, metrics: [] };
  const trend = (proposal: ReturnType<typeof reading>, over = subjects, scoped: { margin_trend: boolean; metrics: unknown[] } | null = scope) =>
    marginTrendSubjects(over, proposal, scoped as never)?.map((subject) => subject.mention) ?? null;
  assert.deepEqual(trend(reading(["margin_trend"], ["income_statement"], ["operating_margin"])), ["NVDA"], "one margin over time");
  assert.deepEqual(trend(reading(["margins", "margin_trend", "explains"])), ["NVDA"], "margins over time and why");
  assert.deepEqual(trend(reading(["margin_trend"], [], [], [], { kind: "latest" })), ["NVDA"], "the latest periods");
  assert.equal(trend(reading(["margins"])), null, "margins, not their trend");
  assert.equal(trend(reading(["margin_trend", "segments"])), null, "segments too");
  assert.equal(trend(reading(["margin_trend"], [], ["revenue"])), null, "another income item");
  assert.equal(trend(reading(["margin_trend"], ["free_cash_flow"])), null, "another metric");
  assert.equal(trend(reading(["margin_trend"], [], [], [], { kind: "fiscal_quarter", fiscal_period: "Q2", fiscal_year: 2025 })), null, "a named quarter");
  assert.equal(trend(reading(["margin_trend"], [], [], ["margins"])), null, "margins turned off");
  assert.equal(trend(reading(["margin_trend"]), planningContext("NVDA and AMD").requested_subjects), null, "two companies");
  assert.equal(trend(reading(["margin_trend"]), subjects, null), null, "no scope");
  // A follow-up naming only another period keeps the trend its scope holds; one naming no period, or a company of its own, does not.
  const kept = { margin_trend: true, metrics: [{ metric_key: "income_statement" }] };
  const q2 = { kind: "fiscal_quarter", fiscal_period: "Q2", fiscal_year: null };
  assert.deepEqual(trend(reading([], [], [], [], q2), subjects, kept), ["NVDA"], "what about Q2");
  assert.deepEqual(trend(reading([], [], [], [], { kind: "fiscal_year", fiscal_year: 2025 }), subjects, kept), ["NVDA"], "and fiscal 2025");
  assert.equal(trend(reading([]), subjects, kept), null, "no other period");
  assert.equal(trend(reading([], [], [], [], q2), subjects, scope), null, "no trend kept");
  assert.equal(trend({ ...reading([], [], [], [], q2), companies: { kind: "as_named", names: ["NVDA"] } }, subjects, kept), null, "a question of its own");
  assert.equal(trend(reading([], [], [], [], q2), subjects, { margin_trend: true, metrics: [{ metric_key: "free_cash_flow" }] }), null, "a figure the trend does not show");
  assert.equal(marginTrendSubjects(subjects, null, scope), null, "no reading");
});

test("a margin trend whose quarters cannot be read says so as a margin trend, and the planner answers (#398)", async (t) => {
  const warned: unknown[][] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => warned.push(args));
  assert.equal(await overviewOf("NVDA", () => ({ status: "error", reason_code: "database_error" }), planMarginTrend), null);
  assert.deepEqual(warned, [["[chat] the margin trend could not be planned; the planner answers", "database_error"]]);
});

test("each golden answer names what its question asks for and its plan does not compute", async () => {
  const client = await createReplayLlmChatClient(REPLIES);
  const reply = async (content: string) => (await client({} as never, { messages: [{ role: "user", content }] })).text;
  const model: PlanningModel = async ({ messages }) => ({ text: (await client({} as never, { messages })).text, model: "recorded" });
  const uncovered: Record<string, string[]> = {
    "Why did AMD's operating margin turn negative in Q2 2025?": ["a margin over several periods", "the cause of these figures"],
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
    assert.deepEqual(uncoveredAsks(parseProposal(await reply(proposalQuestion(question)), question)!, planned.plan), expected, question);
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
    parseProposal(JSON.stringify({ metrics, asks, turns_off: { facets, metrics: offMetrics }, income_items: [], period: { kind: "none" }, companies: { kind: "as_named", names: [] } }), "")!;
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

test("a company's peers fill the turn's company cap, named by their legal names; a database error means none, and a defect fails (#398)", async (t) => {
  const warned: unknown[][] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => warned.push(args));
  const [NVDA, AMD] = ["NVDA", "AMD"].map((ticker) => GOLDEN_COMPANIES.find((company) => company.ticker === ticker)!);
  const nvda = { kind: "issuer" as const, id: NVDA!.issuer_id };
  const database = (failing?: { at: number; error: unknown }) => {
    const values: unknown[][] = [];
    return {
      values,
      query: async (text: string, params: unknown[] = []) => {
        values.push(params);
        if (values.length === failing?.at) throw failing.error;
        return { rows: text.includes("legal_name") ? [{ issuer_id: AMD!.issuer_id, legal_name: AMD!.legal_name }] : [{ issuer_id: AMD!.issuer_id }] };
      },
    } as SqlExecutor & { values: unknown[][] };
  };
  const reachable = database();
  assert.deepEqual(await overviewPeers(reachable, nvda), [
    { mention: AMD!.issuer_id, resolution: { status: "resolved", subject_ref: { kind: "issuer", id: AMD!.issuer_id }, label: AMD!.legal_name } },
  ]);
  assert.deepEqual(reachable.values[0], [NVDA!.issuer_id, MAX_TURN_SUBJECTS - 1], "as many peers as the cap leaves room for");
  const down = Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01" });
  assert.deepEqual(await overviewPeers(database({ at: 1, error: down }), nvda), [], "the peer set cannot be read");
  assert.deepEqual(await overviewPeers(database({ at: 2, error: down }), nvda), [], "the peers' names cannot be read");
  assert.equal(warned.length, 2);
  await assert.rejects(overviewPeers(database({ at: 1, error: new TypeError("a defect") }), nvda), TypeError);
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
