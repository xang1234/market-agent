import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { createReplayLlmChatClient } from "../../llm/src/replay-client.ts";
import { proposedMetric, type CompanyChange, type IncomeItem, type ResearchScope, type ScopeFacet, type ScopePeriod, type ScopeProposal } from "../src/research-scope.ts";
import { routeTurn, type PlanChoice, type ReadPeriod } from "../src/scope-figures.ts";
import { parseProposal, proposalQuestion } from "../src/scope-proposal.ts";

type Reading = {
  asks?: ScopeFacet[];
  metrics?: string[];
  items?: IncomeItem[];
  off?: Array<ScopeFacet | "fiscal_year" | "fiscal_quarter">;
  offMetrics?: string[];
  period?: ScopePeriod;
  companies?: CompanyChange;
};

const read = (reading: Reading = {}): ScopeProposal => ({
  metrics: (reading.metrics ?? []).map((key) => proposedMetric(key, null, null)!),
  asks: new Set(reading.asks ?? []),
  turns_off: { facets: new Set(reading.off ?? []), metrics: new Set(reading.offMetrics ?? []) },
  income_items: reading.items ?? [],
  period: reading.period ?? { kind: "none" },
  companies: reading.companies ?? { kind: "as_named", names: [] },
});

const NVDA = { issuer_id: "60000000-0000-4000-8000-000000000001", label: "NVDA" };
const AMD = { issuer_id: "60000000-0000-4000-8000-000000000002", label: "AMD" };

const scope = (fields: Partial<ResearchScope> = {}): ResearchScope => ({
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
const keeps = (...keys: string[]): Partial<ResearchScope> => ({ metrics: keys.map((key) => proposedMetric(key, null, null)!), inherited: ["metrics"] });

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

// [what the turn is, its reading, its resolved scope, the plan it gets]
const ROUTES: ReadonlyArray<readonly [string, ScopeProposal | null, ResearchScope | null, string]> = [
  ["no reading", null, scope(), "planner"],
  ["a question that asks nothing and names no company", read(), null, "analyst"],
  ["evidence", read({ asks: ["evidence"] }), scope(), "analyst"],
  ["guidance", read({ asks: ["guidance"], companies: named("NVDA") }), scope(), "analyst"],
  ["a price window", read({ asks: ["price_window"], companies: named("NVDA") }), scope(), "analyst"],
  ["peers and a price window", read({ asks: ["peers", "price_window"], companies: named("NVDA") }), scope(), "analyst"],
  ["the latest quarter and a price window", read({ asks: ["latest_quarter", "price_window"], companies: named("NVDA") }), scope(), "analyst"],
  ["a metric with the evidence", read({ metrics: ["income_statement"], asks: ["evidence"], companies: named("NVDA") }), scope(), "planner"],
  ["a metric with a price window", read({ metrics: ["income_statement"], asks: ["price_window"], companies: named("NVDA") }), scope(), "planner"],
  ["a metric turned off, with the evidence", read({ metrics: ["capex"], asks: ["evidence"], offMetrics: ["capex"] }), scope(), "analyst"],
  ["guidance read as asked and turned off", read({ asks: ["guidance"], off: ["guidance"], companies: named("NVDA") }), scope(), "overview at latest"],
  ["a cause", read({ asks: ["explains"] }), scope(), "analyst"],
  ["thanks", read(), scope(), "analyst"],
  ["a cause, with the scope's figures kept", read({ asks: ["explains"] }), scope(keeps("eps_diluted")), "analyst"],
  ["kept guidance, adding a company", read({ companies: adds("AMD") }), scope({ guidance: true }), "analyst"],
  ["kept guidance, another period", read({ period: Q2 }), scope({ guidance: true }), "analyst"],
  ["kept guidance, a company of its own", read({ companies: named("NVDA") }), scope({ guidance: true }), "overview at latest"],
  ["a kept price window", read(), scope({ price_window: YTD }), "analyst"],
  ["a kept benchmark", read(), scope({ benchmark: true }), "analyst"],
  ["a kept price window, another period", read({ period: Q2 }), scope({ price_window: YTD }), "overview at newest Q2"],
  ["segments", read({ asks: ["segments"], companies: named("NVDA") }), scope(), "segments_gap"],
  ["segments with a metric", read({ asks: ["segments"], metrics: ["income_statement"], items: ["revenue"] }), scope(), "segments_gap"],
  ["segments with a margin trend", read({ asks: ["segments", "margins", "margin_trend"] }), scope(), "segments_gap"],
  ["segments with guidance", read({ asks: ["segments", "guidance"] }), scope(), "segments_gap"],
  ["a company", read({ companies: named("NVDA") }), scope(), "overview at latest"],
  ["a company, with no scope", read({ companies: named("NVDA") }), null, "planner"],
  ["two companies", read({ companies: named("NVDA", "AMD") }), scope({ companies: [NVDA, AMD] }), "overview at latest"],
  ["adding a company", read({ companies: adds("AMD") }), scope({ companies: [NVDA, AMD] }), "overview at latest"],
  ["a company's peers", read({ asks: ["peers"], companies: named("NVDA") }), scope(), "overview at latest with peers"],
  ["a metric", read({ metrics: ["income_statement"], companies: named("NVDA") }), scope(), "planner"],
  ["margins turned off", read({ off: ["margins"] }), scope(), "planner"],
  ["a metric turned off", read({ offMetrics: ["income_statement"] }), scope(), "planner"],
  ["a cause, naming the companies", read({ asks: ["explains"], companies: named("NVDA", "AMD") }), scope({ companies: [NVDA, AMD] }), "overview at latest"],
  ["peers turned off", read({ off: ["peers"] }), scope(), "overview at latest"],
  ["a cause of the margins", read({ asks: ["explains", "margins"], companies: named("NVDA") }), scope(), "planner"],
  ["the latest period", read({ period: { kind: "latest" }, companies: named("NVDA") }), scope(), "overview at latest"],
  ["a fiscal year", read({ period: FY2025, companies: named("NVDA") }), scope(), "overview at FY2025"],
  ["a quarter", read({ period: Q2_2025, companies: named("NVDA") }), scope(), "overview at Q2 FY2025"],
  ["a quarter named alone", read({ period: Q2 }), scope(), "overview at newest Q2"],
  ["a quarter named alone, the scope's year", read({ period: Q2 }), scope({ fiscal_year: 2025, fiscal_quarter: { fiscal_year: 2025, fiscal_period: "Q2" } }), "overview at Q2 FY2025"],
  ["no period, the scope's year", read(), scope({ fiscal_year: 2025, inherited: ["fiscal_year"] }), "analyst"],
  ["adding a company, the scope's year", read({ companies: adds("AMD") }), scope({ companies: [NVDA, AMD], fiscal_year: 2025, inherited: ["fiscal_year"] }), "overview at FY2025"],
  ["adding a company, the scope's quarter", read({ companies: adds("AMD") }), scope({ companies: [NVDA, AMD], fiscal_year: 2025, fiscal_quarter: { fiscal_year: 2025, fiscal_period: "Q2" }, inherited: ["fiscal_year", "fiscal_quarter"] }), "overview at Q2 FY2025"],
  ["the latest quarter, the scope's year", read({ period: { kind: "latest" } }), scope({ fiscal_year: 2025, inherited: ["fiscal_year"] }), "overview at latest"],
  ["the trailing twelve months", read({ period: { kind: "trailing_twelve_months" }, companies: named("NVDA") }), scope(), "planner"],
  ["a range", read({ period: { kind: "range" }, companies: named("NVDA") }), scope(), "planner"],
  ["a margin over time", read({ asks: ["margin_trend"], metrics: ["income_statement"], items: ["operating_margin"], companies: named("NVDA") }), scope(), "trend at latest"],
  ["margins over time and why", read({ asks: ["margins", "margin_trend", "explains"], companies: named("NVDA") }), scope(), "trend at latest"],
  ["a margin over the latest periods", read({ asks: ["margin_trend"], period: { kind: "latest" }, companies: named("NVDA") }), scope(), "trend at latest"],
  ["margins, not their trend", read({ asks: ["margins"], companies: named("NVDA") }), scope(), "planner"],
  ["a trend of another income item", read({ asks: ["margin_trend"], items: ["revenue"], companies: named("NVDA") }), scope(), "planner"],
  ["a trend beside another metric", read({ asks: ["margin_trend"], metrics: ["free_cash_flow"], companies: named("NVDA") }), scope(), "planner"],
  ["a trend at a named quarter", read({ asks: ["margin_trend"], period: Q2_2025, companies: named("NVDA") }), scope(), "planner"],
  ["a trend with the margins turned off", read({ asks: ["margin_trend"], off: ["margins"], companies: named("NVDA") }), scope(), "planner"],
  ["a trend of two companies", read({ asks: ["margin_trend"], companies: named("NVDA", "AMD") }), scope({ companies: [NVDA, AMD] }), "planner"],
  ["a trend, with no scope", read({ asks: ["margin_trend"], companies: named("NVDA") }), null, "planner"],
  ["a kept trend, another quarter", read({ period: Q2 }), scope({ margin_trend: true, ...keeps("income_statement") }), "trend at newest Q2"],
  ["a kept trend, another year", read({ period: FY2025 }), scope({ margin_trend: true, ...keeps("income_statement") }), "trend at FY2025"],
  ["a kept trend, no other period", read({ off: ["peers"] }), scope({ margin_trend: true, ...keeps("income_statement") }), "overview at latest"],
  ["a kept trend, adding a company", read({ companies: adds("AMD") }), scope({ companies: [NVDA, AMD], margin_trend: true, ...keeps("income_statement") }), "overview at latest"],
  ["comparing them, naming no company", read({ companies: adds() }), scope({ companies: [NVDA, AMD] }), "analyst"],
  ["a kept trend, a company of its own", read({ period: Q2, companies: named("NVDA") }), scope({ margin_trend: true, ...keeps("income_statement") }), "overview at newest Q2"],
  ["a kept trend beside another figure", read({ period: Q2 }), scope({ margin_trend: true, ...keeps("free_cash_flow") }), "free_cash_flow at newest Q2"],
  ["kept figures, another quarter", read({ period: Q2 }), scope(keeps("free_cash_flow", "capex")), "free_cash_flow, capex at newest Q2"],
  ["kept figures, adding a company", read({ companies: adds("AMD") }), scope({ companies: [NVDA, AMD], ...keeps("free_cash_flow") }), "free_cash_flow at latest"],
  ["kept figures, the latest quarter", read({ asks: ["latest_quarter"] }), scope(keeps("eps_diluted")), "eps_diluted at latest"],
  ["kept income statement, another quarter", read({ period: Q2 }), scope(keeps("income_statement")), "overview at newest Q2"],
  ["kept figures, a margin asked for", read({ asks: ["margins"] }), scope(keeps("free_cash_flow")), "planner"],
  ["kept figures, one turned off", read({ offMetrics: ["capex"] }), scope(keeps("free_cash_flow")), "free_cash_flow at latest"],
];

test("a turn about a company gets one plan, from its reading and its resolved scope (#398)", () => {
  assert.deepEqual(
    ROUTES.map(([name, reading, resolved]) => [name, choiceText(routeTurn(reading, resolved))]),
    ROUTES.map(([name, , , expected]) => [name, expected]),
  );
});

test("each golden question's recorded reading routes as the golden conversation answers it (#398)", async () => {
  const client = await createReplayLlmChatClient(join(import.meta.dirname, "golden", "llm-replies.json"));
  const route = async (question: string, resolved: ResearchScope) => {
    const reply = await client({} as never, { messages: [{ role: "user", content: proposalQuestion(question) }] });
    return choiceText(routeTurn(parseProposal(reply.text, question), resolved));
  };
  assert.deepEqual(
    [
      await route("Analyze NVDA", scope()),
      await route("Compare NVDA with AMD", scope({ companies: [NVDA, AMD] })),
      await route("How does NVDA compare with its peers?", scope({ peers: true })),
      await route("Compare it with AMD YTD", scope({ companies: [NVDA, AMD], price_window: YTD })),
      await route("Explain the differences and show the evidence", scope({ companies: [NVDA, AMD], price_window: YTD })),
      await route("Break down NVDA's revenue by segment", scope({ segments: true })),
      await route("What guidance did AMD give?", scope({ companies: [AMD], guidance: true })),
    ],
    ["overview at latest", "overview at latest", "overview at latest with peers", "analyst", "analyst", "segments_gap", "analyst"],
  );
});
