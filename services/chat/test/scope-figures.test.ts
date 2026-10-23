import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { createReplayLlmChatClient } from "../../llm/src/replay-client.ts";
import { proposedMetric, resolveResearchScope, type CompanyChange, type ResearchScope, type ScopePeriod, type ScopeProposal } from "../src/research-scope.ts";
import { routeTurn, type PlanChoice, type ReadPeriod } from "../src/scope-figures.ts";
import { parseProposal, proposalQuestion } from "../src/scope-proposal.ts";
import { proposal as read } from "./scope-fixtures.ts";

const NVDA = { issuer_id: "60000000-0000-4000-8000-000000000001", label: "NVDA" };
const AMD = { issuer_id: "60000000-0000-4000-8000-000000000002", label: "AMD" };

const AS_OF = "2026-09-01T00:00:00.000Z";

// The previous answer's saved scope, over NVDA unless it says otherwise.
const after = (fields: Partial<ResearchScope> = {}): ResearchScope => ({
  route: "financial_answer",
  reads: "financial_answer",
  companies: [NVDA],
  peers: false,
  segments: false,
  margin_trend: false,
  margins: false,
  metrics: [],
  fiscal_year: null,
  fiscal_quarter: null,
  price_window: null,
  benchmark: false,
  inherited: [],
  ...fields,
});
const keeps = (...keys: string[]): Partial<ResearchScope> => ({ metrics: keys.map((key) => proposedMetric(key, null, null)!) });
const FRESH = null;
// A scope that failed to resolve.
const UNRESOLVED = "unresolved";

const named = (...names: string[]): CompanyChange => ({ kind: "as_named", names });
const adds = (...add: string[]): CompanyChange => ({ kind: "compare", add });
const Q2: ScopePeriod = { kind: "fiscal_quarter", fiscal_period: "Q2", fiscal_year: null };
const Q2_2025: ScopePeriod = { kind: "fiscal_quarter", fiscal_period: "Q2", fiscal_year: 2025 };
const FY2025: ScopePeriod = { kind: "fiscal_year", fiscal_year: 2025 };
const YTD = { kind: "ytd", cutoff: "2026-08-31T00:00:00.000Z" } as const;

function periodText(period: ReadPeriod): string {
  switch (period.kind) {
    case "latest":
      return "latest";
    case "fiscal_year":
      return `FY${period.fiscal_year}`;
    case "fiscal_quarter":
      return period.fiscal_year === null ? `newest ${period.fiscal_period}` : `${period.fiscal_period} FY${period.fiscal_year}`;
  }
}

function choiceText(choice: PlanChoice): string {
  switch (choice.kind) {
    case "trend":
      return `trend at ${periodText(choice.period)}`;
    case "overview":
      return `overview at ${periodText(choice.period)}${choice.peers ? " with peers" : ""}`;
    case "kept_figures":
      return `${choice.metrics.join(", ")} at ${periodText(choice.period)}`;
    default:
      return choice.kind;
  }
}

// [what the turn is, its reading, the scope of the answer before it, the plan it gets]
const ROUTES: ReadonlyArray<readonly [string, ScopeProposal | null, ResearchScope | null | typeof UNRESOLVED, string]> = [
  ["no reading", null, FRESH, "planner"],
  ["a question that asks nothing and names no company", read(), UNRESOLVED, "analyst"],
  ["evidence", read({ asks: ["evidence"] }), FRESH, "analyst"],
  ["guidance", read({ asks: ["guidance"], companies: named("NVDA") }), FRESH, "analyst"],
  ["a price window", read({ asks: ["price_window"], companies: named("NVDA") }), FRESH, "analyst"],
  ["peers and a price window", read({ asks: ["peers", "price_window"], companies: named("NVDA") }), FRESH, "analyst"],
  ["the latest quarter and a price window", read({ asks: ["latest_quarter", "price_window"], companies: named("NVDA") }), FRESH, "analyst"],
  ["a metric with the evidence", read({ metrics: ["income_statement"], asks: ["evidence"], companies: named("NVDA") }), FRESH, "planner"],
  ["a metric with a price window", read({ metrics: ["income_statement"], asks: ["price_window"], companies: named("NVDA") }), FRESH, "planner"],
  ["a metric turned off, with the evidence", read({ metrics: ["capex"], asks: ["evidence"], offMetrics: ["capex"] }), FRESH, "analyst"],
  ["guidance read as asked and turned off", read({ asks: ["guidance"], off: ["guidance"], companies: named("NVDA") }), FRESH, "overview at latest"],
  ["a cause", read({ asks: ["explains"] }), FRESH, "analyst"],
  ["thanks", read(), FRESH, "analyst"],
  ["a cause, with the scope's figures kept", read({ asks: ["explains"] }), after(keeps("eps_diluted")), "analyst"],
  ["kept guidance, adding a company", read({ companies: adds("AMD") }), after({ guidance: true }), "analyst"],
  ["kept guidance, another period", read({ period: Q2 }), after({ guidance: true }), "analyst"],
  ["kept guidance, a company of its own", read({ companies: named("NVDA") }), after({ guidance: true }), "overview at latest"],
  ["a kept price window", read(), after({ price_window: YTD }), "analyst"],
  ["a kept benchmark", read(), after({ benchmark: true }), "analyst"],
  ["a kept price window, another period", read({ period: Q2 }), after({ price_window: YTD }), "overview at newest Q2"],
  ["segments", read({ asks: ["segments"], companies: named("NVDA") }), FRESH, "segments_gap"],
  ["segments with a metric", read({ asks: ["segments"], metrics: ["income_statement"], items: ["revenue"] }), FRESH, "segments_gap"],
  ["segments with a margin trend", read({ asks: ["segments", "margins", "margin_trend"] }), FRESH, "segments_gap"],
  ["segments with guidance", read({ asks: ["segments", "guidance"] }), FRESH, "segments_gap"],
  ["a company", read({ companies: named("NVDA") }), FRESH, "overview at latest"],
  ["a company, with no scope", read({ companies: named("NVDA") }), UNRESOLVED, "planner"],
  ["two companies", read({ companies: named("NVDA", "AMD") }), after({ companies: [NVDA, AMD] }), "overview at latest"],
  ["adding a company", read({ companies: adds("AMD") }), after({ companies: [NVDA, AMD] }), "overview at latest"],
  ["a company's peers", read({ asks: ["peers"], companies: named("NVDA") }), FRESH, "overview at latest with peers"],
  ["a metric", read({ metrics: ["income_statement"], companies: named("NVDA") }), FRESH, "planner"],
  ["margins turned off", read({ off: ["margins"] }), FRESH, "planner"],
  ["a metric turned off", read({ offMetrics: ["income_statement"] }), FRESH, "planner"],
  ["a cause, naming the companies", read({ asks: ["explains"], companies: named("NVDA", "AMD") }), after({ companies: [NVDA, AMD] }), "overview at latest"],
  ["peers turned off", read({ off: ["peers"] }), FRESH, "overview at latest"],
  ["a cause of the margins", read({ asks: ["explains", "margins"], companies: named("NVDA") }), FRESH, "planner"],
  ["the latest period", read({ period: { kind: "latest" }, companies: named("NVDA") }), FRESH, "overview at latest"],
  ["a fiscal year", read({ period: FY2025, companies: named("NVDA") }), FRESH, "overview at FY2025"],
  ["a quarter", read({ period: Q2_2025, companies: named("NVDA") }), FRESH, "overview at Q2 FY2025"],
  ["a quarter named alone", read({ period: Q2 }), FRESH, "overview at newest Q2"],
  ["a quarter named alone, the scope's year", read({ period: Q2 }), after({ fiscal_year: 2025, fiscal_quarter: { fiscal_year: 2025, fiscal_period: "Q2" } }), "overview at Q2 FY2025"],
  ["no period, the scope's year", read(), after({ fiscal_year: 2025 }), "analyst"],
  ["adding a company, the scope's year", read({ companies: adds("AMD") }), after({ companies: [NVDA, AMD], fiscal_year: 2025 }), "overview at FY2025"],
  ["adding a company, the scope's quarter", read({ companies: adds("AMD") }), after({ companies: [NVDA, AMD], fiscal_year: 2025, fiscal_quarter: { fiscal_year: 2025, fiscal_period: "Q2" } }), "overview at Q2 FY2025"],
  ["the latest quarter, the scope's year", read({ period: { kind: "latest" } }), after({ fiscal_year: 2025 }), "overview at latest"],
  ["the trailing twelve months", read({ period: { kind: "trailing_twelve_months" }, companies: named("NVDA") }), FRESH, "planner"],
  ["a range", read({ period: { kind: "range" }, companies: named("NVDA") }), FRESH, "planner"],
  ["a margin over time", read({ asks: ["margin_trend"], metrics: ["income_statement"], items: ["operating_margin"], companies: named("NVDA") }), FRESH, "trend at latest"],
  ["margins over time and why", read({ asks: ["margins", "margin_trend", "explains"], companies: named("NVDA") }), FRESH, "trend at latest"],
  ["a margin over the latest periods", read({ asks: ["margin_trend"], period: { kind: "latest" }, companies: named("NVDA") }), FRESH, "trend at latest"],
  ["margins, not their trend", read({ asks: ["margins"], companies: named("NVDA") }), FRESH, "planner"],
  ["a trend of another income item", read({ asks: ["margin_trend"], items: ["revenue"], companies: named("NVDA") }), FRESH, "planner"],
  ["a trend beside another metric", read({ asks: ["margin_trend"], metrics: ["free_cash_flow"], companies: named("NVDA") }), FRESH, "planner"],
  ["a trend at a named quarter", read({ asks: ["margin_trend"], period: Q2_2025, companies: named("NVDA") }), FRESH, "planner"],
  ["a trend with the margins turned off", read({ asks: ["margin_trend"], off: ["margins"], companies: named("NVDA") }), FRESH, "planner"],
  ["a trend of two companies", read({ asks: ["margin_trend"], companies: named("NVDA", "AMD") }), after({ companies: [NVDA, AMD] }), "planner"],
  ["a trend, with no scope", read({ asks: ["margin_trend"], companies: named("NVDA") }), UNRESOLVED, "planner"],
  ["a kept trend, another quarter", read({ period: Q2 }), after({ margin_trend: true, ...keeps("income_statement") }), "trend at newest Q2"],
  ["a kept trend, another year", read({ period: FY2025 }), after({ margin_trend: true, ...keeps("income_statement") }), "trend at FY2025"],
  ["a kept trend, no other period", read({ off: ["peers"] }), after({ margin_trend: true, ...keeps("income_statement") }), "overview at latest"],
  ["a kept trend, adding a company", read({ companies: adds("AMD") }), after({ companies: [NVDA, AMD], margin_trend: true, ...keeps("income_statement") }), "overview at latest"],
  ["comparing them, naming no company", read({ companies: adds() }), after({ companies: [NVDA, AMD] }), "analyst"],
  ["a kept trend, a company of its own", read({ period: Q2, companies: named("NVDA") }), after({ margin_trend: true, ...keeps("income_statement") }), "overview at newest Q2"],
  ["a kept trend beside another figure", read({ period: Q2 }), after({ margin_trend: true, ...keeps("free_cash_flow") }), "free_cash_flow at newest Q2"],
  ["kept figures, another quarter", read({ period: Q2 }), after(keeps("free_cash_flow", "capex")), "free_cash_flow, capex at newest Q2"],
  ["kept figures, adding a company", read({ companies: adds("AMD") }), after({ companies: [NVDA, AMD], ...keeps("free_cash_flow") }), "free_cash_flow at latest"],
  ["kept figures, the latest quarter", read({ asks: ["latest_quarter"] }), after(keeps("eps_diluted")), "eps_diluted at latest"],
  ["kept income statement, another quarter", read({ period: Q2 }), after(keeps("income_statement")), "overview at newest Q2"],
  ["kept figures, a margin asked for", read({ asks: ["margins"] }), after(keeps("free_cash_flow")), "planner"],
  ["kept figures, one turned off", read({ offMetrics: ["capex"] }), after(keeps("free_cash_flow")), "free_cash_flow at latest"],
];

// The companies a turn covers, as the coordinator takes them from its reading.
function companiesOf(reading: ScopeProposal | null, prior: ResearchScope | null): ResearchScope["companies"] {
  const byName = (name: string) => [NVDA, AMD].find((company) => company.label === name)!;
  const change = reading?.companies;
  if (change?.kind === "as_named" && change.names.length > 0) return change.names.map(byName);
  const companies = [...(prior?.companies ?? [NVDA]), ...(change?.kind === "compare" ? change.add.map(byName) : [])];
  return companies.filter((company, index) => companies.indexOf(company) === index);
}

// The turn's plan, from its reading and its scope as the engine lane resolves it.
function planOf(reading: ScopeProposal | null, prior: ResearchScope | null | typeof UNRESOLVED): string {
  if (prior === UNRESOLVED) return choiceText(routeTurn(reading, null));
  return choiceText(routeTurn(reading, resolveResearchScope({ companies: companiesOf(reading, prior), prior, asOf: AS_OF, served: true, proposal: reading })));
}

test("a turn about a company gets one plan, from its reading and its resolved scope (#398)", () => {
  assert.deepEqual(
    ROUTES.map(([name, reading, prior]) => [name, planOf(reading, prior)]),
    ROUTES.map(([name, , , expected]) => [name, expected]),
  );
});

test("each golden question's recorded reading routes as the golden conversation answers it (#398)", async () => {
  const client = await createReplayLlmChatClient(join(import.meta.dirname, "golden", "llm-replies.json"));
  const route = async (question: string, prior: ResearchScope | null) => {
    const reply = await client({} as never, { messages: [{ role: "user", content: proposalQuestion(question) }] });
    return planOf(parseProposal(reply.text, question), prior);
  };
  assert.deepEqual(
    [
      await route("Analyze NVDA", FRESH),
      await route("Compare NVDA with AMD", FRESH),
      await route("How does NVDA compare with its peers?", FRESH),
      await route("Compare it with AMD YTD", after()),
      await route("Explain the differences and show the evidence", after({ companies: [NVDA, AMD], price_window: YTD })),
      await route("Break down NVDA's revenue by segment", FRESH),
      await route("What guidance did AMD give?", FRESH),
    ],
    ["overview at latest", "overview at latest", "overview at latest with peers", "analyst", "analyst", "segments_gap", "analyst"],
  );
});

test("a quarter named alone is saved as each company's newest such quarter, so a follow-up adding a company reads it there (#398)", () => {
  const turn = (reading: ScopeProposal, prior: ResearchScope | null, companies: ResearchScope["companies"]) => {
    const resolved = resolveResearchScope({ companies, prior, asOf: AS_OF, served: true, proposal: reading });
    return { resolved, plan: choiceText(routeTurn(reading, resolved)) };
  };
  const first = turn(read({ companies: named("NVDA") }), null, [NVDA]);
  const q2 = turn(read({ period: Q2 }), first.resolved, [NVDA]);
  const added = turn(read({ companies: adds("AMD") }), q2.resolved, [NVDA, AMD]);
  assert.deepEqual(
    [first.plan, q2.plan, q2.resolved.fiscal_quarter, added.plan],
    ["overview at latest", "overview at newest Q2", { fiscal_year: null, fiscal_period: "Q2" }, "overview at newest Q2"],
  );
});
